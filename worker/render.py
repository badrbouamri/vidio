"""
M4: renders one clip — cut + reframe + subtitle burn-in + loudnorm in a
single ffmpeg pass (FR-17), plus a thumbnail (FR-20) and SRT/VTT export
(FR-24). Orchestrates ffmpeg_filters.py, faces.py, reframe.py, subtitles.py.

Finished outputs are uploaded to the Next.js app's `/api/internal/clip-versions`
route, which is the only place that touches Vercel Blob (see
docs/DECISIONS.md — no official Python Blob client).
"""

import os
import subprocess

import requests

import faces
import ffmpeg_filters as ff
import ingest
import reframe
import subtitles

APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:3000")
WORKER_INTERNAL_SECRET = os.environ.get("WORKER_INTERNAL_SECRET", "")

DEFAULT_STYLE = "classic"


def _clip_relative(items: list[dict], start_s: float, key_pairs: list[tuple[str, str]]) -> list[dict]:
    """Shifts each item's time fields so 0 lines up with the clip's own
    start — ffmpeg's filter-graph `t` resets the same way after an input
    `-ss` seek (verified empirically; see docs/DECISIONS.md)."""
    shifted = []
    for item in items:
        new_item = dict(item)
        for key in key_pairs:
            new_item[key] = item[key] - start_s
        shifted.append(new_item)
    return shifted


def render_clip(
    source_path: str,
    clip: dict,
    transcript: dict,
    work_dir: str,
    style_name: str = DEFAULT_STYLE,
) -> dict:
    """clip: {"id", "start_s", "end_s"}. transcript: {"words", "segments"}
    (source-absolute timestamps, as persisted). Returns local output paths:
    {"video_path", "thumbnail_path", "srt_path", "vtt_path"}."""
    probe = ingest.probe(source_path)
    source_w, source_h = probe.width, probe.height
    start_s, end_s = clip["start_s"], clip["end_s"]

    words_abs = [w for w in transcript["words"] if start_s <= w["start"] < end_s]
    segments_abs = [s for s in transcript["segments"] if start_s <= s["start"] < end_s]
    words_rel = _clip_relative(words_abs, start_s, ["start", "end"])
    segments_rel = _clip_relative(segments_abs, start_s, ["start", "end"])

    if reframe.is_already_vertical(source_w, source_h):
        strategy, crop_expr = "skip", None
    else:
        samples = faces.sample_face_boxes(source_path, start_s=start_s, end_s=end_s)
        strategy = reframe.select_strategy(source_w, source_h, samples)
        crop_expr = None
        if strategy == "face_track":
            timeline = reframe.crop_x_timeline(samples, source_w, source_h)
            crop_expr = ff.build_crop_x_expr(timeline)

    style = subtitles.STYLE_PRESETS.get(style_name, subtitles.STYLE_PRESETS[DEFAULT_STYLE])
    words = [subtitles.Word(text=w["word"], start=w["start"], end=w["end"]) for w in words_rel]
    cards = subtitles.group_words_into_cards(words)
    ass_content = subtitles.build_ass(cards, style)
    ass_path = os.path.join(work_dir, f"{clip['id']}.ass")
    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(ass_content)

    filter_complex, video_label, audio_label = ff.build_filter_complex(
        strategy, source_w, source_h, ass_path=ass_path, crop_x_expr=crop_expr
    )
    video_path = os.path.join(work_dir, f"{clip['id']}.mp4")
    render_args = ff.build_render_args(
        source_path, video_path, start_s, end_s, filter_complex, video_label, audio_label
    )
    result = subprocess.run(render_args, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg render failed: {result.stderr[-2000:]}")

    thumb_path = os.path.join(work_dir, f"{clip['id']}_thumb.jpg")
    thumb_at = min(1.0, (end_s - start_s) / 2)
    thumb_result = subprocess.run(
        ff.build_thumbnail_args(video_path, thumb_path, thumb_at),
        capture_output=True,
        text=True,
    )
    if thumb_result.returncode != 0:
        raise RuntimeError(f"thumbnail generation failed: {thumb_result.stderr[-2000:]}")

    srt_path = os.path.join(work_dir, f"{clip['id']}.srt")
    vtt_path = os.path.join(work_dir, f"{clip['id']}.vtt")
    with open(srt_path, "w", encoding="utf-8") as f:
        f.write(subtitles.build_srt(segments_rel))
    with open(vtt_path, "w", encoding="utf-8") as f:
        f.write(subtitles.build_vtt(segments_rel))

    return {
        "video_path": video_path,
        "thumbnail_path": thumb_path,
        "srt_path": srt_path,
        "vtt_path": vtt_path,
    }


def upload_clip_version(
    clip_id: str,
    start_s: float,
    end_s: float,
    style_name: str,
    subtitle_lang: str,
    outputs: dict,
) -> None:
    """POSTs the rendered files to the Next.js app, which uploads them to
    Blob and writes the clip_versions row (see docs/DECISIONS.md)."""
    data = {
        "clipId": clip_id,
        "subtitleStyle": style_name,
        "subtitleLang": subtitle_lang,
        "trimStart": str(start_s),
        "trimEnd": str(end_s),
    }
    with (
        open(outputs["video_path"], "rb") as video_f,
        open(outputs["thumbnail_path"], "rb") as thumb_f,
        open(outputs["srt_path"], "rb") as srt_f,
        open(outputs["vtt_path"], "rb") as vtt_f,
    ):
        files = {
            "video": ("clip.mp4", video_f, "video/mp4"),
            "thumbnail": ("thumb.jpg", thumb_f, "image/jpeg"),
            "srt": ("clip.srt", srt_f, "application/x-subrip"),
            "vtt": ("clip.vtt", vtt_f, "text/vtt"),
        }
        resp = requests.post(
            f"{APP_BASE_URL}/api/internal/clip-versions",
            headers={"x-worker-secret": WORKER_INTERNAL_SECRET},
            data=data,
            files=files,
            timeout=120,
        )
    resp.raise_for_status()
