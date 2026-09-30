import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clips, projects } from "@/db/schema";

/** Scoped lookup — never fetch a clip without checking the owning project's
 * userId (see docs/DECISIONS.md — app-level RLS). */
export async function getOwnedClip(userId: string, clipId: string) {
  const db = getDb();
  const [row] = await db
    .select({ clip: clips, ownerId: projects.userId })
    .from(clips)
    .innerJoin(projects, eq(clips.projectId, projects.id))
    .where(and(eq(clips.id, clipId), eq(projects.userId, userId)));
  return row?.clip;
}
