"""
M2.3/M2.4: ingest stage — get the source file, validate it, extract duration.

Stateless-worker refactor (see docs/DECISIONS.md): the worker has no
persistent disk between stages or container restarts (no Railway volume).
Every stage downloads the source fresh into its own scratch dir
(`source_dir`, wiped after the stage by main.py's process_job) rather than
assuming a file left by a previous stage/process is still there.

Uploads are already reachable at `project.storage_key` (a public Blob URL,
set by /api/upload) — any stage can fetch that directly. YouTube sources are
downloaded here (ingest) for the first time via yt-dlp, then immediately
uploaded to the private Blob store (blob_client.py) so `storage_key` becomes
a private-store key every later stage can re-fetch the same way, instead of
a local path that only this one container/process could see.
"""

import json
import os
import subprocess

import requests
import yt_dlp

import blob_client
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
    # project_id comes back from psycopg as a uuid.UUID, not a str, for
    # every caller (main.py's row dicts never stringify it) — os.path.join
    # rejects anything that isn't str/bytes/PathLike, so every ingest job
    # crashed here before this fix, regardless of source type.
    path = os.path.join(STORAGE_DIR, str(project_id))
    os.makedirs(path, exist_ok=True)
    return path


def download_source(project: dict, dest_dir: str) -> str:
    """Downloads this project's source into dest_dir — called fresh by every
    stage that needs it (transcribe, render), not just ingest, since no
    local file survives between stages/container restarts. "upload" sources
    are a public Blob URL (set by /api/upload); "youtube" sources are a
    private-store key (set by run_ingest, below, after yt-dlp)."""
    if project["source_type"] == "upload":
        return download_upload(project["storage_key"], dest_dir)
    dest = os.path.join(dest_dir, "source.mp4")
    return blob_client.download(project["storage_key"], dest)


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
        # Uploaded immediately so storage_key is a Blob key every later
        # stage can re-fetch (download_source, above) regardless of which
        # container ends up running them — see module docstring.
        storage_key = blob_client.upload(
            f"sources/{project['id']}/source.mp4", path, "video/mp4"
        )

    info = probe(path)
    validate_probe(info)
    return {"duration_s": info.duration_s, "storage_key": storage_key}
