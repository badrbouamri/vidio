"""
Nabd worker skeleton (M2.7).

Polls the `jobs` table for queued rows and drives each project through its
pipeline stages. This file only implements the state machine + polling loop;
the actual stage work (STT, moment detection, rendering, translation, dubbing)
is filled in progressively in M3-M6 — each stage function below is a stub.

Heavy processing must never run inside a Vercel Function (PRD §7, §15), so
this runs as its own long-lived process (Docker container on Modal/RunPod/
Railway/Fly.io per PRD §7).
"""

import json
import os
import time
from datetime import datetime, timezone

import psycopg
import requests

import dub
import ffmpeg_filters
import ingest
import log
import plans
import render
import retention
import transcribe
import usage
from validation import ValidationError

DATABASE_URL = os.environ["DATABASE_URL"]
POLL_INTERVAL_S = 5

# M3.5: the LLM moment-detection call runs in the Next.js app (AI Gateway is
# TS-native — see docs/DECISIONS.md), not here. The worker just triggers it
# and waits for the synchronous result.
APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:3000")
WORKER_INTERNAL_SECRET = os.environ.get("WORKER_INTERNAL_SECRET", "")

# Stage order mirrors PRD §9 job_stage enum. Each stage advances the job to
# the next stage on success, or marks it failed with an error message.
STAGE_ORDER = ["ingest", "transcribe", "detect", "render", "translate", "dub"]


def next_stage(stage: str) -> str | None:
    idx = STAGE_ORDER.index(stage)
    return STAGE_ORDER[idx + 1] if idx + 1 < len(STAGE_ORDER) else None


def run_ingest(conn, job, project) -> None:
    """M2: download/validate source, extract duration (FR-5, FR-6)."""
    result = ingest.run(project)
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE projects SET duration_s = %s, storage_key = %s WHERE id = %s",
            (result["duration_s"], result["storage_key"], project["id"]),
        )
    conn.commit()
    # M7.2/edge case §11: meter as soon as duration is known — this is what
    # canStartNewProject() checks against for the user's *next* project.
    usage.record_source_minutes(conn, project["user_id"], project["id"], result["duration_s"])


def run_transcribe(conn, job, project) -> None:
    """M3.1-M3.4: STT with word timestamps; persist transcript (FR-8, FR-9, FR-11)."""
    path = ingest.local_source_path(project)
    language_override = (project["options"] or {}).get("sourceLanguage")
    result = transcribe.transcribe(path, language_override)

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO transcripts (project_id, language, words, segments)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (project_id) DO UPDATE
            SET language = EXCLUDED.language,
                words = EXCLUDED.words,
                segments = EXCLUDED.segments
            """,
            (
                project["id"],
                result["language"],
                json.dumps(result["words"]),
                json.dumps(result["segments"]),
            ),
        )
        cur.execute(
            "UPDATE projects SET language = %s WHERE id = %s",
            (result["language"], project["id"]),
        )
    conn.commit()
    if project["duration_s"]:
        usage.record_job_cost(conn, job["id"], usage.estimate_stt_cost(project["duration_s"]))


def trigger_internal_route(path: str, project_id: str, fallback_error: str, timeout: int = 300) -> dict:
    """POSTs {projectId} to an /api/internal/* route, raises on failure,
    returns the parsed JSON body on success (M7.2: routes report their own
    `costUsd` — the token-usage/pricing math lives with the AI SDK call, in
    the Next.js app). Shared by every stage whose actual work (LLM calls)
    lives there instead of here — see docs/DECISIONS.md."""
    resp = requests.post(
        f"{APP_BASE_URL}{path}",
        headers={"x-worker-secret": WORKER_INTERNAL_SECRET},
        json={"projectId": str(project_id)},
        timeout=timeout,
    )
    if resp.status_code >= 400:
        try:
            message = resp.json().get("error")
        except ValueError:
            message = None
        raise ValidationError(message or resp.text or fallback_error)
    try:
        return resp.json()
    except ValueError:
        return {}


def run_detect(conn, job, project) -> None:
    """M3.5-M3.9: LLM moment detection + scoring (FR-12..FR-16). The actual
    LLM call happens in the Next.js app, which owns the AI Gateway wiring;
    this just triggers it and persists nothing itself (the endpoint writes
    Clip rows directly)."""
    body = trigger_internal_route(
        "/api/internal/detect-moments", project["id"], "Moment detection failed."
    )
    usage.record_job_cost(conn, job["id"], body.get("costUsd", 0))


def run_render(conn, job, project) -> None:
    """M4: FFmpeg cut + reframe + subtitles (FR-17..FR-24). Renders every
    not-yet-ready clip for the project; a per-clip failure doesn't fail the
    whole stage unless every clip fails.

    Includes 'failed' alongside 'pending': a project-level stage retry (the
    dashboard's Retry button, POST /api/projects/:id/start) just re-queues
    this job stage without touching clip rows — restricting the query to
    'pending' only meant retrying after a render failure found zero rows to
    render, silently "succeeded", and advanced the pipeline with the clip
    permanently stuck at 'failed'. Reproduced live. See docs/DECISIONS.md."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, start_s, end_s, subtitle_style, subtitle_words,
                   audio_preference, subtitle_lang_preference, translated_segments
            FROM clips WHERE project_id = %s AND status IN ('pending', 'failed')
            """,
            (project["id"],),
        )
        pending_clips = [
            {
                "id": row[0],
                "start_s": row[1],
                "end_s": row[2],
                "subtitle_style": row[3],
                "subtitle_words": row[4],
                "audio_preference": row[5],
                "subtitle_lang_preference": row[6],
                "translated_segments": row[7],
            }
            for row in cur.fetchall()
        ]
        cur.execute(
            "SELECT words, segments, language FROM transcripts WHERE project_id = %s",
            (project["id"],),
        )
        row = cur.fetchone()

    if not pending_clips:
        return
    if not row:
        raise ValidationError("No transcript found for this project.")
    transcript_words, transcript_segments = row[0], row[1]
    subtitle_lang = row[2]

    default_style = (project["options"] or {}).get("subtitleStyle") or render.DEFAULT_STYLE
    work_dir = ingest.source_dir(project["id"])
    source_path = ingest.local_source_path(project)

    # M7.5: resolution cap + watermark depend on the owner's plan.
    with conn.cursor() as cur:
        cur.execute("SELECT plan FROM users WHERE id = %s", (project["user_id"],))
        plan_row = cur.fetchone()
    plan_settings = plans.render_settings_for_plan(plan_row[0] if plan_row else "free")
    # "720p"/"1080p" name the short (width) edge of our 9:16 portrait output
    # — 1080x1920 is what everyone calls "1080p" vertical video.
    output_w = plan_settings["max_height"]
    output_h = round(output_w / ffmpeg_filters.TARGET_ASPECT)
    watermark = plan_settings["watermark"]

    succeeded = 0
    for clip in pending_clips:
        render_started_at = time.monotonic()
        try:
            # M5.3: a per-clip subtitle style/text override (set via
            # PATCH /api/clips/:id) beats the project-wide default.
            style_name = clip["subtitle_style"] or default_style
            words = clip["subtitle_words"] or transcript_words
            transcript = {"words": words, "segments": transcript_segments}

            # M6.4: audio/subtitle-language toggles set via the clip editor.
            audio_source = clip["audio_preference"] or "original"
            dub_path = dub.dub_track_path(clip["id"], work_dir) if audio_source == "dubbed" else None
            if dub_path and not os.path.exists(dub_path):
                dub_path = None  # not prepared yet (dub stage hasn't run/finished) — fall back

            outputs = render.render_clip(
                source_path,
                clip,
                transcript,
                work_dir,
                style_name,
                audio_source=audio_source if dub_path else "original",
                dub_audio_path=dub_path,
                subtitle_lang_pref=clip["subtitle_lang_preference"] or "original",
                translated_segments=clip["translated_segments"],
                output_w=output_w,
                output_h=output_h,
                watermark=watermark,
            )
            usage.record_job_cost(
                conn, job["id"], usage.estimate_compute_cost(time.monotonic() - render_started_at)
            )
            render.upload_clip_version(
                clip["id"],
                clip["start_s"],
                clip["end_s"],
                style_name,
                subtitle_lang,
                outputs,
                audio_source=audio_source if dub_path else "original",
            )
            with conn.cursor() as cur:
                cur.execute("UPDATE clips SET status = 'ready' WHERE id = %s", (clip["id"],))
            conn.commit()
            succeeded += 1
        except Exception as exc:
            log.error("render.clip_failed", exc, clip_id=clip["id"], project_id=project["id"])
            with conn.cursor() as cur:
                cur.execute("UPDATE clips SET status = 'failed' WHERE id = %s", (clip["id"],))
            conn.commit()

    if succeeded == 0:
        raise ValidationError("All clips failed to render.")


def run_translate(conn, job, project) -> None:
    """M6.1: subtitle translation (FR-25). No-op if the project has no
    target language — the Next.js route itself reports {skipped: true}
    rather than erroring, so this always succeeds in that case."""
    body = trigger_internal_route(
        "/api/internal/translate-subtitles", project["id"], "Subtitle translation failed."
    )
    usage.record_job_cost(conn, job["id"], body.get("costUsd", 0))


def run_dub(conn, job, project) -> None:
    """M6.2/M6.3: TTS dubbing (FR-26). Prepares (generates + locally caches)
    a dubbed audio track per ready clip; does NOT create new ClipVersions —
    the user picks "dubbed" audio in the clip editor and re-renders (M6.4,
    reusing the M5 render endpoint) when they actually want it burned in."""
    if not (project["options"] or {}).get("dubbingEnabled"):
        return

    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, start_s, end_s, translated_segments FROM clips "
            "WHERE project_id = %s AND status = 'ready'",
            (project["id"],),
        )
        ready_clips = [
            {"id": row[0], "start_s": row[1], "end_s": row[2], "translated_segments": row[3]}
            for row in cur.fetchall()
        ]

    if not ready_clips:
        return

    target_language = (project["options"] or {}).get("targetLanguage")
    work_dir = ingest.source_dir(project["id"])
    can_clone = dub.can_use_voice_cloning(project["options"] or {})

    succeeded = 0
    for clip in ready_clips:
        segments = clip["translated_segments"]
        if not segments:
            continue  # translate stage hasn't produced text for this clip yet
        try:
            dub.build_dub_track(clip, segments, target_language, work_dir, allow_voice_cloning=can_clone)
            succeeded += 1

            # M7.2: dubbing consumes extra credits (FR-42), separate from
            # the source-minutes meter; also log the TTS cost for this clip.
            clip_minutes = (clip["end_s"] - clip["start_s"]) / 60
            usage.record_dubbing_credits(conn, project["user_id"], project["id"], clip_minutes)
            char_count = sum(len(s["text"]) for s in segments)
            usage.record_job_cost(conn, job["id"], usage.estimate_tts_cost(char_count))
        except Exception as exc:
            log.error("dub.clip_failed", exc, clip_id=clip["id"], project_id=project["id"])

    if succeeded == 0:
        raise ValidationError("Dubbing failed for every clip.")


STAGE_HANDLERS = {
    "ingest": run_ingest,
    "transcribe": run_transcribe,
    "detect": run_detect,
    "render": run_render,
    "translate": run_translate,
    "dub": run_dub,
}


def claim_next_job(conn):
    """Atomically claim one queued job so multiple worker replicas don't race."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE jobs SET status = 'running', started_at = %s, attempts = attempts + 1
            WHERE id = (
                SELECT id FROM jobs
                WHERE status = 'queued'
                ORDER BY created_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            RETURNING id, project_id, stage, attempts;
            """,
            (datetime.now(timezone.utc),),
        )
        row = cur.fetchone()
        conn.commit()
        if not row:
            return None
        return {"id": row[0], "project_id": row[1], "stage": row[2], "attempts": row[3]}


def fetch_project(conn, project_id):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, user_id, source_type, source_url, storage_key, options, duration_s "
            "FROM projects WHERE id = %s",
            (project_id,),
        )
        row = cur.fetchone()
        return {
            "id": row[0],
            "user_id": row[1],
            "source_type": row[2],
            "source_url": row[3],
            "storage_key": row[4],
            "options": row[5],
            "duration_s": row[6],
        }


def mark_done(conn, job, project):
    nxt = next_stage(job["stage"])
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE jobs SET status = 'done', progress = 100, finished_at = %s WHERE id = %s",
            (datetime.now(timezone.utc), job["id"]),
        )
        if nxt:
            cur.execute(
                "INSERT INTO jobs (project_id, stage, status) VALUES (%s, %s, 'queued')",
                (project["id"], nxt),
            )
        else:
            cur.execute(
                "UPDATE projects SET status = 'done' WHERE id = %s", (project["id"],)
            )
    conn.commit()


def mark_failed(conn, job, project, error: str):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE jobs SET status = 'failed', error = %s, finished_at = %s WHERE id = %s",
            (error, datetime.now(timezone.utc), job["id"]),
        )
        cur.execute(
            "UPDATE projects SET status = 'failed' WHERE id = %s", (project["id"],)
        )
    conn.commit()


def process_job(conn, job):
    project = fetch_project(conn, job["project_id"])
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE projects SET status = 'processing' WHERE id = %s", (project["id"],)
        )
        conn.commit()

    try:
        STAGE_HANDLERS[job["stage"]](conn, job, project)
        mark_done(conn, job, project)
    except Exception as exc:  # noqa: BLE001 - report any stage failure, retried via FR-38
        log.error("job.stage_failed", exc, job_id=job["id"], project_id=project["id"], stage=job["stage"])
        mark_failed(conn, job, project, str(exc))


RETENTION_SWEEP_INTERVAL_S = 60 * 60  # M8.4: once an hour is plenty


def main():
    log.info("worker.started", poll_interval_s=POLL_INTERVAL_S)
    last_retention_sweep = 0.0
    with psycopg.connect(DATABASE_URL, autocommit=False) as conn:
        while True:
            job = claim_next_job(conn)
            if job:
                process_job(conn, job)
            else:
                time.sleep(POLL_INTERVAL_S)

            if time.time() - last_retention_sweep >= RETENTION_SWEEP_INTERVAL_S:
                removed = retention.sweep_old_source_files(ingest.STORAGE_DIR)
                if removed:
                    log.info("retention.swept", removed_count=len(removed))
                last_retention_sweep = time.time()


if __name__ == "__main__":
    main()
