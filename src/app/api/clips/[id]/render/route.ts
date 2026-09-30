import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clips, jobs } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { getOwnedClip } from "@/lib/clips";

// §9 POST /api/clips/:id/render — enqueue a re-render (FR-32: creates a new
// ClipVersion; the prior version stays downloadable until replaced).
//
// Reuses the existing project-level `render` stage machinery as-is: setting
// just this one clip back to "pending" and queuing a `render`-stage job
// means the worker's run_render (which renders every pending clip for the
// project) naturally renders only this clip — no worker changes needed.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireUserId();
  const { id } = await params;
  const clip = await getOwnedClip(userId, id);
  if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (clip.status === "pending" || clip.status === "rendering") {
    return NextResponse.json(
      { error: "This clip is already rendering." },
      { status: 409 },
    );
  }

  const db = getDb();
  await db.update(clips).set({ status: "pending" }).where(eq(clips.id, id));

  const [job] = await db
    .insert(jobs)
    .values({ projectId: clip.projectId, stage: "render", status: "queued" })
    .returning();

  return NextResponse.json({ job }, { status: 201 });
}
