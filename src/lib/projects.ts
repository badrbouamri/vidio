import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { projects } from "@/db/schema";

/** Scoped lookup — never fetch a project without checking ownership (see docs/DECISIONS.md). */
export async function getOwnedProject(userId: string, projectId: string) {
  const db = getDb();
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  return project;
}
