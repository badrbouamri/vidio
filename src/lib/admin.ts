import { forbidden } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { requireUserId } from "@/lib/auth";

// FR-44/M8.1: restricted admin access. No self-serve admin invite flow —
// promote a user by setting `users.is_admin = true` directly in the DB.
// Uses Next's built-in forbidden() (next.config.ts: experimental.authInterrupts).
export async function requireAdmin(): Promise<string> {
  const userId = await requireUserId();
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.isAdmin) forbidden();
  return userId;
}
