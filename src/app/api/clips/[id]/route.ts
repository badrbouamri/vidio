import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clips, projects, transcripts, type TranscriptWord } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { getOwnedClip } from "@/lib/clips";
import { MAX_TRIM_DELTA_S, validateTrim } from "@/lib/trim";

// FR-29/FR-30: clip detail for the editor — the clip itself, plus
// transcript words spanning the widest possible trim range (±30s beyond the
// original segment) so the mini transcript strip has context to scrub.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireUserId();
  const { id } = await params;
  const clip = await getOwnedClip(userId, id);
  if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const db = getDb();
  const [project] = await db.select().from(projects).where(eq(projects.id, clip.projectId));
  const [transcript] = await db
    .select()
    .from(transcripts)
    .where(eq(transcripts.projectId, clip.projectId));

  const windowStart = clip.originalStartS - MAX_TRIM_DELTA_S;
  const windowEnd = clip.originalEndS + MAX_TRIM_DELTA_S;
  const words: TranscriptWord[] =
    transcript?.words.filter((w) => w.start >= windowStart && w.start < windowEnd) ?? [];

  return NextResponse.json({
    clip,
    sourceDurationS: project?.durationS ?? null,
    words,
    dubbingEnabled: Boolean(project?.options.dubbingEnabled),
    targetLanguage: project?.options.targetLanguage ?? null,
  });
}

type PatchBody = Partial<{
  title: string;
  hashtags: string[];
  startS: number;
  endS: number;
  subtitleStyle: string | null;
  subtitleWords: TranscriptWord[] | null;
  // M6.4: which the *next* re-render should use.
  audioPreference: "original" | "dubbed";
  subtitleLangPreference: "original" | "translated";
}>;

// FR-31/FR-30: trim/text/style/title edits. Does not re-render — that's the
// separate POST /api/clips/:id/render (§9), so a user can queue up several
// edits before spending a render.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireUserId();
  const { id } = await params;
  const clip = await getOwnedClip(userId, id);
  if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json()) as PatchBody;
  const db = getDb();

  const updates: Record<string, unknown> = {};

  if (body.title !== undefined) {
    if (!body.title.trim()) {
      return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
    }
    updates.title = body.title.trim();
  }
  if (body.hashtags !== undefined) updates.hashtags = body.hashtags;
  if (body.subtitleStyle !== undefined) updates.subtitleStyle = body.subtitleStyle;
  if (body.subtitleWords !== undefined) updates.subtitleWords = body.subtitleWords;
  if (body.audioPreference !== undefined) updates.audioPreference = body.audioPreference;
  if (body.subtitleLangPreference !== undefined) {
    updates.subtitleLangPreference = body.subtitleLangPreference;
  }

  if (body.startS !== undefined || body.endS !== undefined) {
    const newStart = body.startS ?? clip.startS;
    const newEnd = body.endS ?? clip.endS;
    const [project] = await db.select().from(projects).where(eq(projects.id, clip.projectId));
    const result = validateTrim(
      clip.originalStartS,
      clip.originalEndS,
      newStart,
      newEnd,
      project?.durationS ?? undefined,
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 400 });
    }
    updates.startS = newStart;
    updates.endS = newEnd;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(clips)
    .set(updates)
    .where(eq(clips.id, id))
    .returning();

  return NextResponse.json({ clip: updated });
}
