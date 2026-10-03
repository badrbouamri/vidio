"""
Stateless-worker refactor (see docs/DECISIONS.md): the worker has no
persistent disk between stages or container restarts (no Railway volume —
deliberately not added). Every stage downloads its inputs from Blob at
start and uploads its outputs before marking itself done, instead of
assuming a local file survived from an earlier stage/process.

This talks to the Next.js app's generic /api/internal/blob proxy rather
than Vercel Blob directly — there is no official Vercel Blob client for
Python, and the JS SDK's HTTP contract is internal/versioned (see
docs/DECISIONS.md's "worker-local source storage" entry, same rationale as
render.py's existing upload_clip_version). Always the private store; these
are worker-internal artifacts (a YouTube-ingested source copy, a built
dub-audio track), never a user-facing download.
"""

import os

import requests

APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:3000")
WORKER_INTERNAL_SECRET = os.environ.get("WORKER_INTERNAL_SECRET", "")


def upload(key: str, path: str, content_type: str = "application/octet-stream") -> str:
    """Uploads a local file to the private Blob store at an exact key
    (overwrites any existing object there). Returns the stored key."""
    with open(path, "rb") as f:
        resp = requests.post(
            f"{APP_BASE_URL}/api/internal/blob",
            headers={"x-worker-secret": WORKER_INTERNAL_SECRET},
            data={"key": key},
            files={"file": (os.path.basename(path), f, content_type)},
            timeout=300,
        )
    resp.raise_for_status()
    return resp.json()["key"]


def download(key: str, dest_path: str) -> str:
    """Downloads a private-store blob by key to dest_path. Returns dest_path."""
    with requests.get(
        f"{APP_BASE_URL}/api/internal/blob",
        headers={"x-worker-secret": WORKER_INTERNAL_SECRET},
        params={"key": key},
        timeout=300,
        stream=True,
    ) as resp:
        resp.raise_for_status()
        with open(dest_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8 * 1024 * 1024):
                f.write(chunk)
    return dest_path
