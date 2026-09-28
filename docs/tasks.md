# Nabd — Milestones & Tasks

Source: [PRD.md](./PRD.md). FR/NFR references point back to PRD sections. Each milestone ends with a working, deployable build and passing tests. Record any assumption made while executing a task in `docs/DECISIONS.md`.

---

## M1 — Foundation
Repo, Next.js app, Supabase auth, DB schema, object storage, CI, environment config.

- M1.1 Scaffold Next.js (App Router) + TypeScript + Tailwind + shadcn/ui; repo on GitHub; base folder structure (`app/`, `lib/`, `worker/`, `docs/`).
- M1.2 Provision Supabase project: Postgres, Auth, Realtime. Store connection/service keys server-side only (never client-exposed) — NFR Security.
- M1.3 DB schema & migrations for core entities: User, Project, Job, Transcript, Clip, ClipVersion, UsageEvent (§8). Enable row-level security so each user sees only their own rows (FR-2).
- M1.4 Auth: email+password and Google OAuth via Supabase Auth (FR-1); session handling in Next.js middleware.
- M1.5 Object storage bucket (Supabase Storage or Cloudflare R2), private by default, signed URL helper (used later for upload/download).
- M1.6 Environment config: `.env.example`, `vercel env` wiring for local/preview/prod; secrets never in client bundle.
- M1.7 CI: lint, typecheck, unit tests on PR; Vercel preview deploys on PR.
- M1.8 Base app shell: layout, nav, empty Dashboard page gated behind auth (UI screen 3 skeleton, §10).
- M1.9 Tests: auth flow (sign up/in/out), RLS policy tests (user A cannot read user B's rows).

## M2 — Ingest
Project creation, direct upload (pre-signed, resumable), YouTube import, file validation, job queue + worker skeleton, progress UI.

- M2.1 `POST /api/projects` — create project row, return pre-signed multipart upload URL (FR-4, §9).
- M2.2 Browser-side resumable/multipart upload to storage; resume on interruption (FR-4, edge case §11).
- M2.3 YouTube URL import: worker-side download, clear error on unavailable/private video (FR-5).
- M2.4 Client-side + server-side file validation: format (MP4/MOV/MKV/WEBM), duration/size caps, audio track present; readable rejection reasons (FR-6, edge case: reject before upload completes where feasible).
- M2.5 Projects list UI: thumbnail, name, status, created date, clip count; delete project cascades file/job cleanup (FR-7, UI screen 3).
- M2.6 New Project UI: upload/URL input + options (source language/auto-detect, clip length preference, max clips, subtitle preset, target language + dubbing toggle) (UI screen 4, §4 steps 2–3).
- M2.7 Job queue setup (BullMQ/Upstash, Postgres-backed queue, or Inngest/Trigger.dev) + worker service skeleton (Python/Docker) that can receive a job message and update status (§7, §9 message contract).
- M2.8 `POST /api/projects/:id/start` — validate options, enqueue pipeline (§9).
- M2.9 Progress UI: stage tracker (Uploading → Transcribing → Finding moments → Rendering → Translating/Dubbing) via polling or realtime subscription (FR-37, UI screen 5).
- M2.10 Job failure handling: show failing stage + message, retry from failed stage without re-upload (FR-38).
- M2.11 Tests: upload validation rejects bad files with correct reasons; job enqueue → worker receives message; resume-after-interruption for multipart upload.

## M3 — Transcription & Moment Detection
Speech-to-text with word timestamps, transcript storage/view, LLM moment scoring, clip records.

- M3.1 Integrate STT (faster-whisper/WhisperX or hosted API) in worker: word-level timestamps (FR-8).
- M3.2 Language auto-detection with manual override (FR-9); flag low-confidence segments for mixed-language audio (edge case §11).
- M3.3 Speaker diarization where available, stored alongside transcript words (FR-10).
- M3.4 Persist full transcript (words + segments) to DB; project page transcript viewer (FR-11).
- M3.5 LLM moment-detection pass over chunked transcript: candidate segments with hook/flow/value/emotion sub-scores, title, hashtags, reason; validate against the JSON schema in PRD §9, retry up to 2× on invalid output (FR-12, FR-13, FR-16).
- M3.6 Snap segment boundaries to sentence/word boundaries (FR-14); deduplicate overlapping candidates; respect user's length preference and max-clip count (FR-15).
- M3.7 Minimum score threshold — if the LLM returns fewer clips than requested, show what exists rather than padding with weak clips (edge case §11).
- M3.8 Handle "no speech detected" case: report clearly, offer audio-energy-based highlights or stop (edge case §11).
- M3.9 Persist Clip records (start/end/title/hashtags/score/sub_scores/reason) linked to project.
- M3.10 Tests: schema validation + retry logic for malformed LLM output; boundary-snapping correctness; dedup logic; threshold filtering.

## M4 — Rendering
FFmpeg cutting, 9:16 reframing (face tracking + fallbacks), animated subtitle burn-in, thumbnails, clips gallery, downloads.

- M4.1 FFmpeg cut per candidate segment from source, single re-encode pass (FR-17).
- M4.2 Face/speaker detection (e.g., MediaPipe) for 9:16 reframing with smoothed camera motion; fallback to center crop or blurred-background letterbox when no face found (FR-18, edge case: multiple speakers/no face); skip reframing if source is already vertical (edge case §11).
- M4.3 Output encoding: H.264 MP4, 1080×1920, 30fps, AAC, loudness normalized ~-14 LUFS (FR-19).
- M4.4 Thumbnail generation per clip (FR-20).
- M4.5 Burned-in animated word-by-word (karaoke) subtitles, max 2 lines, safe-zone positioned; Arabic/RTL shaping support (FR-21, FR-23).
- M4.6 At least 4 subtitle style presets (font/size/color/outline/highlight/uppercase/emoji) (FR-22).
- M4.7 Export SRT/VTT per clip (FR-24).
- M4.8 Clips gallery UI: cards sorted by score, filters (length/score), bulk select (UI screen 6, §4 step 5).
- M4.9 Download: single MP4 / SRT, signed URLs expiring ~24h (FR-33 partial, FR-34).
- M4.10 Tests: reframing fallback selection logic; subtitle safe-zone positioning; RTL rendering; output spec compliance (resolution/fps/codec/loudness).

## M5 — Clip Editor
Trim, subtitle text/style editing, style presets, re-render, clip versioning, ZIP export.

- M5.1 Clip editor UI: preview player + mini waveform/transcript strip (FR-29, UI screen 7).
- M5.2 Trim handles bounded to ±30s of original segment, synced to transcript strip (FR-30).
- M5.3 Inline subtitle text editing (timing preserved), style preset switcher, title editing (FR-31).
- M5.4 `PATCH /api/clips/:id` for edits; `POST /api/clips/:id/render` to enqueue re-render (§9).
- M5.5 Re-render creates a new ClipVersion; prior version stays downloadable until replaced (FR-32, §8 ClipVersion).
- M5.6 Copy title + hashtags to clipboard (FR-35).
- M5.7 `POST /api/clips/export` — async ZIP job of selected clips, returns signed URL (FR-33, §9).
- M5.8 Tests: trim bounds enforcement; version history retained after re-render; ZIP export contains correct selected clips.

## M6 — Translation & Dubbing
Subtitle translation, TTS dubbing, original/dubbed audio toggle.

- M6.1 LLM subtitle translation to target language, timing kept aligned per segment (FR-25); v1 targets: English, French, Arabic (MSA), German, Spanish (FR-28).
- M6.2 TTS dubbing: generate target-language speech, time-stretch to fit each segment (up to 1.25×, else shorten translation and regenerate) (FR-26, edge case §11).
- M6.3 Source separation when available to mix dub under original background audio, else replace voice track (FR-26). Voice cloning off by default, opt-in with explicit consent confirmation (FR-26 assumption).
- M6.4 Clip editor: toggle original/dubbed audio and original/translated subtitles, then re-render (FR-27).
- M6.5 Tests: time-stretch fallback path; audio/subtitle toggle produces correct ClipVersion; consent gate blocks voice cloning without confirmation.

## M7 — Billing & Limits
Plans, usage metering, payments, watermark, usage/account page.

- M7.1 Define plan tiers: free (60 min/mo, watermark, 720p) and paid (more minutes, no watermark, 1080p, dubbing) (FR-40, FR-41).
- M7.2 Usage metering in source-minutes-processed; dubbing consumes extra credits; log per-job cost (STT/LLM/TTS/compute) (FR-42, NFR cost control).
- M7.3 Stripe integration (or Paddle/Lemon Squeezy fallback per target market) for subscriptions/payments (FR-43).
- M7.4 Enforce hard caps per plan; block new projects when out of minutes but let in-flight job finish; show upgrade prompt (edge case §11).
- M7.5 Watermark overlay applied to free-tier exports; 720p cap enforced.
- M7.6 Account & billing UI: plan, remaining minutes, usage history, invoices (FR-3, UI screen 8).
- M7.7 Tests: metering accuracy; cap enforcement (mid-job vs. new-project blocking); watermark applied only on free tier.

## M8 — Hardening & Launch
Admin dashboard, observability, cost tracking, edge cases from PRD §11, landing page, legal pages, E2E tests.

- M8.1 Admin view: users, jobs, failures, cost per job, refund minutes (FR-44, UI screen 9, restricted access).
- M8.2 Observability: Sentry (web + worker), structured logs, per-job cost table surfaced in admin (§7 observability).
- M8.3 Sweep remaining edge cases from PRD §11 not yet covered by earlier milestones (verify each explicitly).
- M8.4 Data retention: auto-delete source files after 30 days; user-initiated delete-anytime; confirm no data used for training (NFR privacy).
- M8.5 Landing page: value prop, examples, pricing, CTA (UI screen 1).
- M8.6 Legal pages: Terms (rights-to-content requirement, edge case §11), Privacy Policy.
- M8.7 i18n: UI in English and French at launch; verify RTL-ready architecture for Arabic (NFR i18n).
- M8.8 Accessibility pass: keyboard navigation, WCAG AA contrast (NFR accessibility).
- M8.9 E2E tests covering the full happy path (§4) plus key edge cases; load/perf check against NFR target (60-min source → first clips ≤ 20 min).
- M8.10 Pre-launch checklist: confirm all §14 open questions have been resolved and recorded in `docs/DECISIONS.md`.
