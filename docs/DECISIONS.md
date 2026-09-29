# Decisions & Assumptions Log

Per PRD §15: every assumption made during implementation is recorded here.

## Stack

- **Auth: Clerk** (not Supabase Auth as suggested in PRD §7). PRD marks the recommended stack as "[ASSUMPTION — any equivalent is acceptable]". This environment is Vercel-native; Clerk is Vercel's preferred native Marketplace auth integration (auto-provisioned env vars, unified billing). Covers FR-1/FR-2/FR-3.
- **Database: Neon Postgres** (not Supabase Postgres). Same rationale — Neon is Vercel's preferred native Marketplace Postgres. Using Drizzle ORM (`drizzle-orm/neon-http`) per `vercel-storage` skill guidance.
- **Storage: Vercel Blob** (not Supabase Storage / Cloudflare R2). Native Vercel product, supports both public and private access, client-side multipart/resumable upload up to 5TB — fits FR-4's resumable upload requirement directly.
- **Realtime/progress (FR-37): polling**, not a realtime subscription. Neon has no built-in realtime channel like Supabase; FR-37 explicitly allows "polling or server-sent events / realtime subscription," so the worker writes job progress to the `Job` row and the client polls `GET /api/projects/:id`.
- **Row-level access control (NFR Security):** enforced at the application/API layer (every query scoped by the authenticated Clerk `userId`), not via Postgres RLS. Neon does not have Supabase's built-in `auth.uid()`-integrated RLS; Clerk is not a Postgres-native identity provider. This is an architecture deviation from the PRD's literal "Row-level access control" phrasing but satisfies the same goal (FR-2: users only see their own data). Revisit if compliance requirements later demand DB-enforced RLS.

## Known blockers / pending user action

- **2026-09-29 — Vercel Marketplace CLI terms-acceptance loop.** `vercel integration add clerk` and `vercel integration add neon` repeatedly returned `integration_terms_acceptance_required` even after the user confirmed accepting terms in-browser three times. Filed as a product bug via feedback. Working around it by having the user install both directly from the Vercel dashboard (Marketplace UI / project Integrations tab) instead of the CLI flow. **Until this is confirmed done, DB schema/migrations and auth wiring in the app are blocked** — code for them can be written against the expected env vars (`DATABASE_URL`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`) but not run/migrated until the integrations are live and `vercel env pull` succeeds.

## Open questions from PRD §14 — not yet decided

1. Monetization model (SaaS subscription vs. one-time source sale) — assuming SaaS subscription per PRD body (§5.11) until told otherwise.
2. Target market / currency / payment provider — deferred to M7.
3. Worker hosting budget (GPU serverless vs. fixed VPS) — deferred to M2 (worker skeleton) / M3 (STT).
4. Hosted AI APIs vs. self-hosted models — assuming hosted APIs for v1 speed-to-build; revisit if cost data from M3 says otherwise.
5. Voice cloning in scope for v1 — PRD FR-26 already says off by default, opt-in with consent; treating as "in scope but gated," not "out of scope."
6. YouTube URL import in scope — PRD FR-5 assumes yes; keeping it, but worker-side download must respect YouTube ToS (no bypassing DRM/age-gates; fail gracefully rather than scrape around restrictions).
7. Product name — using "Nabd" per PRD assumption.
