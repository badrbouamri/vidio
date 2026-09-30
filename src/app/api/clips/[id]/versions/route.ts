import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clipVersions } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { getOwnedClip } from "@/lib/clips";

// FR-32: "previous version stays downloadable until replaced" — this lists
// every version so the editor can offer old ones, not just the current one.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireUserId();
  const { id } = await params;
  const clip = await getOwnedClip(userId, id);
  if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const db = getDb();
  const versions = await db
    .select()
    .from(clipVersions)
    .where(eq(clipVersions.clipId, id))
    .orderBy(desc(clipVersions.createdAt));

  return NextResponse.json({ versions, currentVersionId: clip.currentVersionId });
}
