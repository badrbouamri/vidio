"""
M2.3/M2.4: ingest stage — get the source file onto local disk, validate it,
extract duration.

Source files stay in the worker's own storage (see docs/DECISIONS.md —
"worker-local source storage"): only rendered clip outputs (M4/M5) need to be
browser-downloadable, so the raw source never needs to touch Vercel Blob.
Uploads are already reachable at `project.storage_key` (a public Blob URL,
set by /api/upload); this just downloads them locally for ffprobe/ffmpeg.
YouTube sources are downloaded here for the first time.
"""

import json
import os
import subprocess

import requests
import yt_dlp

from validation import ValidationError, parse_ffprobe, validate_probe

STORAGE_DIR = os.environ.get("WORKER_STORAGE_DIR", "/data/nabd")

_YTDLP_ERROR_HINTS = [
    ("private video", "This YouTube video is private."),
    ("sign in", "This YouTube video is private."),
    ("age-restricted", "This YouTube video is age-restricted and can't be imported."),
    ("video unavailable", "This YouTube video is unavailable (removed or region-blocked)."),
    ("copyright", "This YouTube video was taken down and can't be imported."),
]


def source_dir(project_id: str) -> str:
    path = os.path.join(STORAGE_DIR, project_id)
    os.makedirs(path, exist_ok=True)
    return path


def local_source_path(project: dict) -> str:
    """Where the ingest stage put this project's source file on local disk
    (see docs/DECISIONS.md — "worker-local source storage"). Later stages
    (transcribe, render) read from here instead of re-downloading."""
    if project["source_type"] == "upload":
        return os.path.join(source_dir(project["id"]), "source")
    return project["storage_key"]  # youtube: local path saved by run_ingest


def download_upload(storage_key: str, dest_dir: str) -> str:
    dest = os.path.join(dest_dir, "source")
    with requests.get(storage_key, stream=True, timeout=60) as resp:
        resp.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8 * 1024 * 1024):
                f.write(chunk)
    return dest


def download_youtube(url: str, dest_dir: str) -> str:
    opts = {
        "outtmpl": os.path.join(dest_dir, "source.%(ext)s"),
        "format": "bv*[ext=mp4]+ba[ext=m4a]/mp4/best",
        "merge_output_format": "mp4",
        "quiet": True,
        "noprogress": True,
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
            return ydl.prepare_filename(info)
    except yt_dlp.utils.DownloadError as exc:
        message = str(exc)
        lowered = message.lower()
        for hint, reason in _YTDLP_ERROR_HINTS:
            if hint in lowered:
                raise ValidationError(reason) from exc
        raise ValidationError(f"Could not import this YouTube video: {message}") from exc


def probe(path: str):
    result = subprocess.run(
        [
            "ffprobe",
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            path,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return parse_ffprobe(json.loads(result.stdout))


def run(project: dict) -> dict:
    """Downloads + validates the source. Returns fields to persist on the
    project row: duration_s, storage_key."""
    dest_dir = source_dir(project["id"])

    if project["source_type"] == "upload":
        if not project["storage_key"]:
            raise ValidationError("Upload has not completed yet.")
        path = download_upload(project["storage_key"], dest_dir)
        storage_key = project["storage_key"]
    else:
        path = download_youtube(project["source_url"], dest_dir)
        storage_key = path

    info = probe(path)
    validate_probe(info)
    return {"duration_s": info.duration_s, "storage_key": storage_key}
