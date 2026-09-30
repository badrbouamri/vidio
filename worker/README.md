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
- `render` (M4/M6.4) — for every pending Clip: face-detects to pick a
  reframing strategy (faces.py/reframe.py), builds karaoke ASS subtitles
  (subtitles.py) — or static translated-language captions if the clip's
  `subtitle_lang_preference` is "translated" — cuts + reframes + burns
  subtitles + loudness-normalizes in one ffmpeg pass, swapping in the
  clip's cached dub track instead of the source's own audio when
  `audio_preference` is "dubbed" (ffmpeg_filters.py/render.py). Generates a
  thumbnail and SRT/VTT, then uploads everything to
  `/api/internal/clip-versions` in the Next.js app (only place that touches
  Blob for clip outputs — see docs/DECISIONS.md). A single clip's failure
  doesn't fail the whole stage.
- `translate` (M6.1) — triggers `/api/internal/translate-subtitles` (LLM
  translation lives there, same reason as `detect` — see docs/DECISIONS.md).
  A no-op if the project has no `targetLanguage`.
- `dub` (M6.2/M6.3) — for every ready Clip with translated text: TTS each
  segment (dub.py), time-stretch to fit (up to 1.25x) or ask for a shorter
  translation and retry, then assemble into one clip-length track
  (ffmpeg_filters.py's adelay/amix). Caches the track locally for `render`
  to pick up later — does not itself create a ClipVersion (the user opts
  into dubbed audio in the clip editor and re-renders, M6.4). A no-op if
  the project doesn't have `dubbingEnabled`. Voice cloning is gated
  (`dub.can_use_voice_cloning`) but no cloning provider is wired up yet —
  see docs/DECISIONS.md.

Source files are kept on the worker's own local disk (`WORKER_STORAGE_DIR`),
not re-uploaded to Blob — see docs/DECISIONS.md ("worker-local source
storage") for why, and its single-instance-or-shared-volume assumption.

## Run locally

```bash
pip install -r requirements-dev.txt   # includes pytest
DATABASE_URL=postgres://... \
STT_API_KEY=sk-... \
TTS_API_KEY=sk-... \
APP_BASE_URL=http://localhost:3000 \
WORKER_INTERNAL_SECRET=... \
python main.py
```

## Test

```bash
pytest
```

Mostly pure logic (ffprobe/yt-dlp parsing, validation, stage transitions,
reframe-strategy selection, ffmpeg/dub filter-string construction, ASS/SRT/VTT
generation, time-stretch/shorten fallback decisions) — no network access
required. `test_render_integration.py` additionally runs real ffmpeg (cuts,
subtitle burn-in, face detection, dub-track assembly) against synthetic
sources it generates itself — GitHub-hosted `ubuntu-latest` runners ship
ffmpeg preinstalled, so this runs in CI too, not just locally; it
self-skips (`pytest.mark.skipif`) only where `ffmpeg`/`ffprobe` (or
opencv, for the pixel-sampling checks) truly aren't on PATH.

## Deploy

Build the image (installs `ffmpeg` — with libass/libfribidi/libharfbuzz for
subtitle burn-in and RTL, and librubberband for dub time-stretching, see
Dockerfile — plus `libgl1`/`libglib2.0-0` for opencv/mediapipe) and run it
as a long-lived process on Modal / RunPod / Railway / Fly.io (PRD §7 — never
inside a Vercel Function). Requires `DATABASE_URL` (same as the Next.js app,
from `vercel env pull`), `STT_API_KEY`, `TTS_API_KEY`, `APP_BASE_URL` (the
deployed Next.js app's URL), and `WORKER_INTERNAL_SECRET` (shared with that
app).
