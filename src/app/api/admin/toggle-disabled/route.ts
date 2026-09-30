import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { log } from "@/lib/log";

// Edge case §11: "Copyright/abuse → ... admin can disable accounts."
export async function POST(req: Request) {
  const adminId = await requireAdmin();
  const { userId, disabled } = (await req.json()) as {
    userId?: string;
    disabled?: boolean;
  };

  if (!userId || typeof disabled !== "boolean") {
    return NextResponse.json(
      { error: "userId and a boolean disabled are required" },
      { status: 400 },
    );
  }

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  await db.update(users).set({ isDisabled: disabled }).where(eq(users.id, userId));
  log.info("admin.toggle_disabled", { adminId, userId, disabled });

  return NextResponse.json({ ok: true });
}
