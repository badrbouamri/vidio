# PRD — Nabd: AI Short-Form Video Clipping, Subtitling & Dubbing

**Version:** 1.0 (draft)
**Reference product:** ClipUno — https://clipuno.vercel.app/
**Status:** Ready for milestone planning. Items marked **[ASSUMPTION]** were decided without Q&A and should be confirmed; items in §14 are open questions.

---

## 1. Summary

Nabd is a web application that turns long videos (podcasts, interviews, talks, streams, tutorials) into ready-to-post vertical short clips for TikTok, YouTube Shorts and Instagram Reels. An AI pipeline transcribes the video, finds and scores the most engaging moments, cuts them, reframes them to 9:16 around the speaker, burns in styled animated subtitles, and optionally translates the subtitles and dubs the audio into another language.

The reference product (ClipUno) is sold as source code for a one-time price and describes itself as an AI pipeline that finds, scores and cuts the best short-form moments from long videos. Nabd reproduces that core pipeline and extends it with translation and dubbing.

## 2. Problem & goals

**Problem.** Manually finding highlights in a 60-minute video, cutting them, reframing to vertical, and captioning takes hours per video. Creators who want to reach other language audiences must additionally translate and re-voice content, which is expensive.

**Goals**
- G1: From a long video, produce 5–15 ranked candidate clips in under ~1× the source duration of processing time.
- G2: Every clip is directly postable: 9:16, 1080×1920, subtitles burned in, 15–90 s.
- G3: Let the user adjust a clip (trim, subtitle text/style, title) without leaving the app.
- G4: Translate subtitles and dub audio into at least French, English, Arabic and German.
- G5: Deployable by a small team: frontend on Vercel, code on GitHub, heavy processing on a separate worker.

**Non-goals (v1)**
- A full multi-track timeline editor (CapCut/Premiere-style).
- Direct auto-publishing to social platforms (export/download only).
- Live-stream clipping in real time.
- Mobile native apps.
- Team workspaces / collaboration.

## 3. Target users

| Persona | Need |
|---|---|
| Solo creator / TikToker | Repurpose own long videos into many shorts quickly, grow views. |
| Podcaster | Clip episodes into promotional shorts with speaker-focused framing. |
| Clipping agency / freelancer | Process many client videos, pick best clips, deliver files. |
| Multilingual creator | Reach a second-language audience via translated subtitles and dubbed audio. |

## 4. User flow (happy path)

1. User signs up / logs in.
2. User creates a **Project** by uploading a video file or pasting a YouTube URL. **[ASSUMPTION: URL import supported for YouTube only in v1; user confirms they have rights to the content.]**
3. User picks options: source language (or auto-detect), clip length preference (short 15–30 s / medium 30–60 s / long 60–90 s), max number of clips, subtitle style preset, optional target language + dubbing on/off.
4. Job is queued; the user sees a progress screen with stages (Uploading → Transcribing → Finding moments → Rendering clips → Translating/Dubbing).
5. User receives the **Clips gallery**: clips sorted by virality score, each with title, score, reason, duration and preview player.
6. User opens a clip in the **Clip editor**: adjust start/end, edit subtitle text, change style, toggle dubbed/original audio, regenerate.
7. User downloads the MP4 (single or ZIP of selected clips) and the SRT file.

## 5. Functional requirements

### 5.1 Authentication & account
- FR-1: Email + password and Google OAuth sign-in.
- FR-2: Each user sees only their own projects, jobs and files.
- FR-3: Account page showing plan, remaining processing minutes, and usage history.

### 5.2 Project & ingest
- FR-4: Upload video (MP4, MOV, MKV, WEBM), max 2 GB and 3 hours **[ASSUMPTION]**. Upload directly from the browser to object storage via pre-signed URL with resumable/multipart upload.
- FR-5: Import from YouTube URL; the worker downloads the source. Show a clear error if unavailable/private.
- FR-6: Validate file (duration, codec, audio track present) before queueing; reject with a readable reason.
- FR-7: Projects list with thumbnail, name, status, created date, number of clips; delete project (deletes all files).

### 5.3 Transcription
- FR-8: Speech-to-text with word-level timestamps (Whisper / faster-whisper / WhisperX or a hosted STT API).
- FR-9: Language auto-detection with manual override.
- FR-10: Speaker diarization where available (used for reframing and optional speaker labels).
- FR-11: Store the full transcript; user can view it in the project.

### 5.4 Moment detection & scoring
- FR-12: An LLM analyzes the timestamped transcript in chunks and proposes candidate segments that are self-contained (clear hook, complete thought, strong ending).
- FR-13: Each candidate gets a **virality score 0–100** and sub-scores: Hook, Flow/coherence, Value/insight, Emotion/trend. Plus a one-sentence reason and a suggested title and hashtags.
- FR-14: Segment boundaries snap to sentence/word boundaries; no clip starts or ends mid-word.
- FR-15: Deduplicate overlapping candidates; respect the user's length preference and max-clip count.
- FR-16: Output must be structured JSON validated against a schema; invalid LLM output is retried up to 2 times.

### 5.5 Rendering (cut + reframe)
- FR-17: Cut each segment with FFmpeg from the original source (no re-encoding generational loss beyond one pass).
- FR-18: Reframe 16:9 → 9:16 using face/speaker detection to keep the active speaker centered, with smoothed camera motion (no jitter). Fallback: center crop, or blurred-background letterbox if no face is found.
- FR-19: Output: H.264 MP4, 1080×1920, 30 fps, AAC audio, loudness normalized (~-14 LUFS).
- FR-20: Generate a thumbnail per clip.

### 5.6 Subtitles
- FR-21: Burned-in animated subtitles, word-by-word highlight (karaoke style), max 2 lines, positioned in the safe zone (not hidden by TikTok/Reels UI).
- FR-22: At least 4 style presets (font, size, color, outline, highlight color, uppercase on/off, emoji on/off). **[ASSUMPTION]**
- FR-23: Arabic and other RTL text renders correctly (shaping + right-to-left).
- FR-24: Export an SRT/VTT file per clip.

### 5.7 Translation & dubbing
- FR-25: Translate clip subtitles to a target language (LLM translation, keeping timing aligned per segment).
- FR-26: Dubbing: generate target-language speech with TTS, time-stretched to fit each original segment; mix under original background audio if source separation is available, otherwise replace the voice track. **[ASSUMPTION: voice cloning is optional, off by default, and requires the user to confirm the voice is theirs or they have consent.]**
- FR-27: Clip editor lets the user switch between original and dubbed audio, and between original and translated subtitles, then re-render.
- FR-28: Supported target languages in v1: English, French, Arabic (MSA), German, Spanish. **[ASSUMPTION]**

### 5.8 Clip editor
- FR-29: Preview player with the rendered clip.
- FR-30: Adjust start/end by dragging handles on a mini waveform/transcript strip (bounded to ±30 s of the original segment).
- FR-31: Edit subtitle text inline (timing kept); change style preset; edit title.
- FR-32: "Re-render" creates a new version; previous version stays downloadable until replaced.

### 5.9 Export
- FR-33: Download single MP4, SRT, or a ZIP of selected clips.
- FR-34: Download links are signed and expire (e.g., 24 h).
- FR-35: Copy title + hashtags to clipboard.

### 5.10 Jobs, progress & notifications
- FR-36: Every processing step runs as an asynchronous job in a queue; the web app never processes video in a request handler.
- FR-37: Real-time progress per stage (polling or server-sent events / realtime subscription).
- FR-38: Failed jobs show the failing stage and a human-readable message; user can retry from the failed stage without re-uploading.
- FR-39: Email notification when a project finishes (optional toggle).

### 5.11 Plans & billing **[ASSUMPTION — to confirm]**
- FR-40: Free tier: 60 processing minutes/month, watermark on exports, max 720p.
- FR-41: Paid tier(s) with more minutes, no watermark, 1080p, dubbing enabled.
- FR-42: Usage is metered in **source video minutes processed**; dubbing consumes extra credits.
- FR-43: Payments via Stripe (or Paddle / Lemon Squeezy if Stripe is unavailable for the business country).

### 5.12 Admin
- FR-44: Admin view: users, jobs, failures, cost per job (STT/LLM/TTS/compute), ability to refund minutes.

## 6. Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | 60-min source → first clips visible in ≤ 20 min on standard tier. |
| Scalability | Worker pool scales horizontally; queue supports concurrency limits per user. |
| Reliability | Jobs are idempotent and resumable per stage; intermediate artifacts cached. |
| Security | Row-level access control on all user data; private storage buckets; signed URLs; secrets only server-side. |
| Privacy | Source files auto-deleted after 30 days **[ASSUMPTION]**; user can delete anytime; data never used for training. |
| Cost control | Per-job cost logged; hard caps per plan; LLM calls chunked and cached. |
| Accessibility | Keyboard navigable UI, WCAG AA contrast. |
| i18n | UI in English and French at launch; architecture ready for Arabic (RTL). |
| Browser support | Latest Chrome, Edge, Firefox, Safari; responsive down to tablet; mobile view for gallery/download. |

## 7. Architecture

Vercel serverless functions cannot run long FFmpeg/ML jobs (time and memory limits), so the system is split in two:

```
┌──────────────┐    ┌───────────────────┐    ┌──────────────────────┐
│  Next.js app │───▶│ Postgres (+ auth, │◀───│  Worker service      │
│  (Vercel)    │    │  realtime)        │    │  (Python, Docker,    │
│  UI + API    │    └───────────────────┘    │   GPU optional)      │
│  routes      │───▶ Job queue ─────────────▶│  FFmpeg, STT, LLM,   │
└──────┬───────┘                             │  face tracking, TTS  │
       │  pre-signed upload/download         └──────────┬───────────┘
       ▼                                                ▼
            ┌──────────────── Object storage (S3/R2) ────────────────┐
```

**Recommended stack [ASSUMPTION — any equivalent is acceptable]**
- Frontend/API: Next.js (App Router) + TypeScript + Tailwind + shadcn/ui, deployed on Vercel, repo on GitHub.
- Auth + DB + realtime: Supabase (Postgres with row-level security).
- Storage: Cloudflare R2 or Supabase Storage (S3-compatible).
- Queue: Redis-based queue (e.g., BullMQ/Upstash) or Postgres-backed queue; or a managed runner (Modal, Trigger.dev, Inngest).
- Worker: Python 3.11 in Docker, deployed on Modal / RunPod / Railway / Fly.io (GPU for Whisper and face tracking).
- AI: Whisper/faster-whisper (or hosted STT API) · LLM via API for scoring/titles/translation · MediaPipe or similar for face detection · TTS API (e.g., ElevenLabs / OpenAI TTS) for dubbing.
- Payments: Stripe (or alternative per §5.11).
- Observability: Sentry (web + worker), structured logs, per-job cost table.

## 8. Data model (core entities)

- **User**: id, email, name, plan, minutes_used_period, created_at.
- **Project**: id, user_id, name, source_type (upload|youtube), source_url, storage_key, duration_s, language, status, options (json), created_at.
- **Job**: id, project_id, stage (ingest|transcribe|detect|render|translate|dub), status (queued|running|done|failed), progress (0–100), error, attempts, cost_usd, started_at, finished_at.
- **Transcript**: project_id, language, words (json: word, start, end, speaker), segments (json).
- **Clip**: id, project_id, start_s, end_s, title, hashtags, score, sub_scores (json), reason, status, current_version_id.
- **ClipVersion**: id, clip_id, subtitle_style, subtitle_lang, audio (original|dubbed), trim (json), video_key, srt_key, thumbnail_key, created_at.
- **UsageEvent**: id, user_id, project_id, type, minutes, credits, created_at.

## 9. Key API / job contracts

- `POST /api/projects` → create project, returns pre-signed upload URL.
- `POST /api/projects/:id/start` → validate + enqueue pipeline.
- `GET /api/projects/:id` → project, jobs, clips.
- `PATCH /api/clips/:id` → trim/text/style changes; `POST /api/clips/:id/render` → enqueue re-render.
- `POST /api/clips/export` → ZIP of selected clips (async job, returns signed URL).
- Worker consumes messages `{ job_id, project_id, stage, payload }`, writes progress to DB, uploads outputs to storage, enqueues the next stage.

LLM moment-detection output schema:
```json
{ "clips": [ { "start": 123.4, "end": 171.9, "title": "string",
  "hashtags": ["string"], "score": 0, "sub_scores": { "hook": 0,
  "flow": 0, "value": 0, "trend": 0 }, "reason": "string" } ] }
```

## 10. UI screens

1. Landing page (value prop, examples, pricing, CTA).
2. Sign in / Sign up.
3. Dashboard — projects list + "New project".
4. New project — upload/URL + options.
5. Processing — stage progress.
6. Clips gallery — cards sorted by score, filters (length, score), bulk select/download.
7. Clip editor — player, trim strip, subtitle editor, style presets, language/audio toggles.
8. Account & billing — plan, usage, invoices.
9. Admin (restricted).

Visual direction: dark UI, bold accent color, video-first cards (similar feel to the reference product).

## 11. Edge cases

- Video with no speech / music only → report "no speech detected", offer center-cut highlights by audio energy or stop.
- Multiple speakers on screen / no face → fallback framing (FR-18).
- Source already vertical → skip reframing.
- Very long source (> limit) → reject before upload finishes (check metadata client-side where possible).
- Mixed-language speech → transcribe with detected dominant language; flag low-confidence segments.
- LLM returns fewer clips than requested → show what exists, no padding with weak clips (min score threshold, e.g., 40).
- Dubbed speech longer than the segment → time-stretch up to 1.25×, otherwise shorten translation and regenerate.
- User runs out of minutes mid-job → job finishes current project; new projects blocked with upgrade prompt.
- Upload interrupted → resume multipart upload.
- Copyright/abuse → Terms require rights to content; admin can disable accounts.

## 12. Success metrics

- Time from upload to first clip (p50, p90).
- % of generated clips downloaded (proxy for quality); target ≥ 30%.
- Average clips downloaded per project.
- Job failure rate < 3%.
- Cost per processed source minute vs. revenue per minute.
- Free → paid conversion.

## 13. Milestone guidance (for tasks.md)

- **M1 Foundation** — repo, Next.js app, Supabase auth, DB schema, storage, CI, environment config.
- **M2 Ingest** — projects, direct upload, YouTube import, validation, job queue + worker skeleton, progress UI.
- **M3 Transcription & moment detection** — STT, transcript storage/view, LLM scoring, clip records.
- **M4 Rendering** — FFmpeg cutting, 9:16 reframing, subtitles burn-in, thumbnails, clips gallery, downloads.
- **M5 Clip editor** — trim, subtitle edit, style presets, re-render, versions, ZIP export.
- **M6 Translation & dubbing** — translated subtitles, TTS dubbing, audio toggle.
- **M7 Billing & limits** — plans, metering, payments, watermark, usage page.
- **M8 Hardening & launch** — admin, observability, cost tracking, edge cases, landing page, legal pages, E2E tests.

Each milestone ends with a working, deployable build and passing tests.

## 14. Open questions (decide before or during M1)

1. Monetization model: SaaS subscription (this PRD) vs. selling source code one-time like the reference product?
2. Target market and currency — affects payment provider (Stripe availability) and pricing.
3. Worker hosting budget: GPU serverless (pay per second) vs. a fixed VPS?
4. Hosted AI APIs (faster to build, per-use cost) vs. self-hosted open-source models (cheaper at scale, more ops)?
5. Is voice cloning in scope for v1, or only stock TTS voices?
6. Is YouTube URL import in scope given platform terms, or upload only?
7. Final product name and brand (Nabd assumed).

## 15. Rules for the implementing agent

- Do not stop to ask for decisions that can be derived from this PRD, the reference product, the established architecture, or standard engineering practice.
- Stop and ask only when a decision materially changes product scope, UX, architecture, security, cost, or business logic.
- Record every assumption made during implementation in `docs/DECISIONS.md`.
- Never process video inside Vercel functions; all heavy work goes through the worker.
- Never expose API keys or service-role keys to the client.
