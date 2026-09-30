"""
M8.4/NFR Privacy: "source files auto-deleted after 30 days" — the
worker-local half. Deletes each project's local source-file cache
(WORKER_STORAGE_DIR/<projectId>/) once it's older than the retention
window. The Next.js app's /api/cron/retention handles the other half (the
Blob-hosted upload source) — see docs/DECISIONS.md.
"""

import os
import shutil
import time

RETENTION_DAYS = 30
RETENTION_SECONDS = RETENTION_DAYS * 24 * 60 * 60


def sweep_old_source_files(storage_dir: str, now: float | None = None) -> list[str]:
    """Deletes each per-project subdirectory under storage_dir whose mtime
    is older than the retention window. Returns the removed project ids."""
    now = time.time() if now is None else now
    removed = []
    if not os.path.isdir(storage_dir):
        return removed

    for name in os.listdir(storage_dir):
        path = os.path.join(storage_dir, name)
        if not os.path.isdir(path):
            continue
        age_s = now - os.path.getmtime(path)
        if age_s >= RETENTION_SECONDS:
            shutil.rmtree(path, ignore_errors=True)
            removed.append(name)
    return removed
