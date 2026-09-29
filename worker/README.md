# Nabd worker (M2 skeleton)

Polls the `jobs` table (Postgres-backed queue, per PRD §7) and drives each
project through its pipeline stages. Stage bodies are stubs until M3-M6 land.

## Run locally

```bash
pip install -r requirements.txt
DATABASE_URL=postgres://... python main.py
```

## Deploy

Build the image and run it as a long-lived process on Modal / RunPod /
Railway / Fly.io (PRD §7 — never inside a Vercel Function). Requires the
same `DATABASE_URL` as the Next.js app (from `vercel env pull`).
