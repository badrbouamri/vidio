import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { del } from "@vercel/blob";
import { getDb } from "@/db";
import { clips, clipVersions, jobs, projects } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { PRIVATE_BLOB_TOKEN } from "@/lib/blob";
import { getOwnedProject } from "@/lib/projects";

// §9 GET /api/projects/:id — project, jobs, clips.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireUserId();
  const { id } = await params;
  const project = await getOwnedProject(userId, id);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const db = getDb();
  const [projectJobs, projectClips] = await Promise.all([
    db.select().from(jobs).where(eq(jobs.projectId, id)),
    db.select().from(clips).where(eq(clips.projectId, id)),
  ]);

  return NextResponse.json({ project, jobs: projectJobs, clips: projectClips });
}

// FR-7: delete project deletes all files. DB rows cascade via FK constraints;
// this also best-effort deletes the underlying Blob objects.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireUserId();
  const { id } = await params;
  const project = await getOwnedProject(userId, id);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const db = getDb();
  const projectClips = await db
    .select()
    .from(clips)
    .where(eq(clips.projectId, id));

  const versionKeys = (
    await Promise.all(
      projectClips.map((clip) =>
        db
          .select()
          .from(clipVersions)
          .where(eq(clipVersions.clipId, clip.id)),
      ),
    )
  ).flat();

  // video/srt live in the private store, storageKey/thumbnail in the
  // default public store (see src/lib/blob.ts) — each needs its own token.
  const publicKeys = [project.storageKey, ...versionKeys.map((v) => v.thumbnailKey)].filter(
    (k): k is string => Boolean(k),
  );
  const privateKeys = versionKeys
    .flatMap((v) => [v.videoKey, v.srtKey])
    .filter((k): k is string => Boolean(k));

  await Promise.allSettled([
    ...publicKeys.map((key) => del(key)),
    ...privateKeys.map((key) => del(key, { token: PRIVATE_BLOB_TOKEN })),
  ]);
  await db.delete(projects).where(eq(projects.id, id));

  return NextResponse.json({ ok: true });
}
