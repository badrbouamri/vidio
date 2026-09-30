import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { projects, users, type ProjectOptions } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { isYoutubeUrl } from "@/lib/video-validation";

// FR-7: list the current user's projects only.
export async function GET() {
  const userId = await requireUserId();
  const db = getDb();
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.createdAt));
  return NextResponse.json({ projects: rows });
}

type CreateProjectBody = {
  name: string;
  sourceType: "upload" | "youtube";
  sourceUrl?: string; // required when sourceType === "youtube"
  options?: ProjectOptions;
};

// FR-4/FR-5/§9: create a project. Upload flow returns a client-upload token
// (see /api/upload) rather than a pre-signed URL here, per @vercel/blob's
// client-upload pattern.
export async function POST(req: Request) {
  const userId = await requireUserId();
  const body = (await req.json()) as CreateProjectBody;

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (body.sourceType === "youtube") {
    if (!body.sourceUrl || !isYoutubeUrl(body.sourceUrl)) {
      return NextResponse.json(
        { error: "A valid YouTube URL is required." },
        { status: 400 },
      );
    }
  } else if (body.sourceType !== "upload") {
    return NextResponse.json(
      { error: 'sourceType must be "upload" or "youtube"' },
      { status: 400 },
    );
  }

  const db = getDb();

  // Ensure a users row exists (Clerk owns identity; we mirror it for billing/usage).
  await db
    .insert(users)
    .values({ id: userId, email: "" })
    .onConflictDoNothing();

  // Edge case §11: "admin can disable accounts."
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (user?.isDisabled) {
    return NextResponse.json(
      { error: "This account has been disabled. Contact support." },
      { status: 403 },
    );
  }

  const [project] = await db
    .insert(projects)
    .values({
      userId,
      name: body.name.trim(),
      sourceType: body.sourceType,
      sourceUrl: body.sourceType === "youtube" ? body.sourceUrl : null,
      status: "created",
      options: body.options ?? {},
    })
    .returning();

  return NextResponse.json({ project }, { status: 201 });
}
