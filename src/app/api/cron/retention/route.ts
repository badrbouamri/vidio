import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { projects } from "@/db/schema";
import { log } from "@/lib/log";

// M8.4/NFR Privacy: "source files auto-deleted after 30 days." Only the
// *source* (the original upload) is in scope here — rendered clip outputs
// are the product's deliverable and aren't touched by this policy. YouTube
// sources live on the worker's own disk (see docs/DECISIONS.md —
// "worker-local source storage"), not Blob, so they're outside this sweep;
// that cleanup is the worker's own concern.
//
// Triggered by Vercel Cron (vercel.ts, daily) — authenticated via the
// `CRON_SECRET` env var Vercel sends as a bearer token, not a Clerk
// session, so this route is deliberately outside proxy.ts's matcher.
const RETENTION_DAYS = 30;

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const db = getDb();

  const stale = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.sourceType, "upload"),
        isNotNull(projects.storageKey),
        lt(projects.createdAt, cutoff),
      ),
    );

  let deleted = 0;
  for (const project of stale) {
    try {
      await del(project.storageKey!);
      await db.update(projects).set({ storageKey: null }).where(eq(projects.id, project.id));
      deleted += 1;
    } catch (err) {
      log.error("retention.delete_failed", err, { projectId: project.id });
    }
  }

  log.info("retention.swept", { checked: stale.length, deleted });
  return NextResponse.json({ ok: true, checked: stale.length, deleted });
}
