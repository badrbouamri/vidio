# Nabd worker

Polls the `jobs` table (Postgres-backed queue, per PRD §7) and drives each
project through its pipeline stages:

- `ingest` (M2) — download source (upload URL or YouTube via yt-dlp),
  validate with ffprobe, extract duration.
- `transcribe` (M3) — STT with word timestamps via a hosted API, persists to
  the `transcripts` table.
- `detect` (M3) — triggers `/api/internal/detect-moments` in the Next.js app
  (LLM moment detection lives there — see docs/DECISIONS.md) and waits for it
  to persist Clip rows.
- `render` / `translate` / `dub` — stubs until M4-M6 land.

Source files are kept on the worker's own local disk (`WORKER_STORAGE_DIR`),
not re-uploaded to Blob — see docs/DECISIONS.md ("worker-local source
storage") for why, and its single-instance-or-shared-volume assumption.

## Run locally

```bash
pip install -r requirements-dev.txt   # includes pytest
DATABASE_URL=postgres://... \
STT_API_KEY=sk-... \
APP_BASE_URL=http://localhost:3000 \
WORKER_INTERNAL_SECRET=... \
python main.py
```

## Test

```bash
pytest
```

Pure logic only (ffprobe/yt-dlp parsing, validation, stage transitions) — no
network or real ffmpeg binary required.

## Deploy

Build the image (installs `ffmpeg` for `ffprobe` — see Dockerfile) and run it
as a long-lived process on Modal / RunPod / Railway / Fly.io (PRD §7 — never
inside a Vercel Function). Requires `DATABASE_URL` (same as the Next.js app,
from `vercel env pull`), `STT_API_KEY`, `APP_BASE_URL` (the deployed Next.js
app's URL), and `WORKER_INTERNAL_SECRET` (shared with that app).
