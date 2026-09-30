import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { usageEvents, users } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { log } from "@/lib/log";

// FR-44: admin can refund minutes. Recorded as a negative usage_event
// (type "refund") for an audit trail, alongside decrementing the live
// counter that /api/projects/:id/start's cap check reads.
export async function POST(req: Request) {
  const adminId = await requireAdmin();
  const { userId, minutes } = (await req.json()) as { userId?: string; minutes?: number };

  if (!userId || typeof minutes !== "number" || minutes <= 0) {
    return NextResponse.json(
      { error: "userId and a positive minutes amount are required" },
      { status: 400 },
    );
  }

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  await db
    .update(users)
    .set({ minutesUsedPeriod: sql`GREATEST(0, ${users.minutesUsedPeriod} - ${minutes})` })
    .where(eq(users.id, userId));

  await db.insert(usageEvents).values({
    userId,
    type: "refund",
    minutes: -minutes,
    credits: 0,
  });

  log.info("admin.refund", { adminId, userId, minutes });

  return NextResponse.json({ ok: true });
}
