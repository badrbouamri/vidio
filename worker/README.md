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
- `render` (M4) — for every pending Clip: face-detects to pick a reframing
  strategy (faces.py/reframe.py), builds karaoke ASS subtitles (subtitles.py),
  cuts + reframes + burns subtitles + loudness-normalizes in one ffmpeg pass
  (ffmpeg_filters.py/render.py), generates a thumbnail and SRT/VTT, then
  uploads everything to `/api/internal/clip-versions` in the Next.js app
  (only place that touches Blob for clip outputs — see docs/DECISIONS.md).
  A single clip's failure doesn't fail the whole stage.
- `translate` / `dub` — stubs until M6 lands.

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

Mostly pure logic (ffprobe/yt-dlp parsing, validation, stage transitions,
reframe-strategy selection, ffmpeg filter-string construction, ASS/SRT/VTT
generation) — no network access required. Face detection (faces.py) and the
actual ffmpeg subprocess calls (render.py) are exercised for real during
development (a synthetic ffmpeg-generated source + MediaPipe's bundled
model — see docs/DECISIONS.md) but aren't part of the `pytest` run, since CI
doesn't have ffmpeg/mediapipe installed.

## Deploy

Build the image (installs `ffmpeg` — with libass/libfribidi/libharfbuzz for
subtitle burn-in and RTL, see Dockerfile — plus `libgl1`/`libglib2.0-0` for
opencv/mediapipe) and run it as a long-lived process on Modal / RunPod /
Railway / Fly.io (PRD §7 — never inside a Vercel Function). Requires
`DATABASE_URL` (same as the Next.js app, from `vercel env pull`),
`STT_API_KEY`, `APP_BASE_URL` (the deployed Next.js app's URL), and
`WORKER_INTERNAL_SECRET` (shared with that app).
