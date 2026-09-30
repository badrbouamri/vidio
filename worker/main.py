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
import traceback
from datetime import datetime, timezone

import psycopg
import requests

import ingest
import transcribe
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


def run_detect(conn, job, project) -> None:
    """M3.5-M3.9: LLM moment detection + scoring (FR-12..FR-16). The actual
    LLM call happens in the Next.js app, which owns the AI Gateway wiring;
    this just triggers it and persists nothing itself (the endpoint writes
    Clip rows directly)."""
    resp = requests.post(
        f"{APP_BASE_URL}/api/internal/detect-moments",
        headers={"x-worker-secret": WORKER_INTERNAL_SECRET},
        json={"projectId": project["id"]},
        timeout=300,
    )
    if resp.status_code >= 400:
        try:
            message = resp.json().get("error")
        except ValueError:
            message = None
        raise ValidationError(message or resp.text or "Moment detection failed.")


def run_render(conn, job, project) -> None:
    """M4: FFmpeg cut + reframe + subtitles (FR-17..FR-24)."""
    raise NotImplementedError("render stage not implemented yet (M4)")


def run_translate(conn, job, project) -> None:
    """M6: subtitle translation (FR-25)."""
    raise NotImplementedError("translate stage not implemented yet (M6)")


def run_dub(conn, job, project) -> None:
    """M6: TTS dubbing (FR-26)."""
    raise NotImplementedError("dub stage not implemented yet (M6)")


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
            "SELECT id, source_type, source_url, storage_key, options FROM projects WHERE id = %s",
            (project_id,),
        )
        row = cur.fetchone()
        return {
            "id": row[0],
            "source_type": row[1],
            "source_url": row[2],
            "storage_key": row[3],
            "options": row[4],
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
        traceback.print_exc()
        mark_failed(conn, job, project, str(exc))


def main():
    print("Nabd worker started, polling for jobs every", POLL_INTERVAL_S, "s")
    with psycopg.connect(DATABASE_URL, autocommit=False) as conn:
        while True:
            job = claim_next_job(conn)
            if job:
                process_job(conn, job)
            else:
                time.sleep(POLL_INTERVAL_S)


if __name__ == "__main__":
    main()
