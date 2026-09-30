import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clips, projects, transcripts, type TranscriptSegment } from "@/db/schema";
import { withRetries } from "@/lib/detect-moments";
import { validateTranslatedAlignment } from "@/lib/dubbing";

// Machine-to-machine route — same pattern as /api/internal/detect-moments
// (LLM calls live here, not in the Python worker — see docs/DECISIONS.md).
const WORKER_INTERNAL_SECRET = process.env.WORKER_INTERNAL_SECRET;

const translationSchema = z.object({ translations: z.array(z.string()) });

// FR-25: translate each segment's text; timing is never entrusted to the
// model at all — we zip its translated strings back onto the ORIGINAL
// segments' start/end ourselves, so "timing kept aligned per segment" holds
// by construction, not by hoping the model echoes numbers correctly.
async function translateSegments(
  segments: TranscriptSegment[],
  targetLanguage: string,
): Promise<TranscriptSegment[]> {
  const { object } = await withRetries(async () => {
    const result = await generateObject({
      model: "anthropic/claude-sonnet-4.6",
      schema: translationSchema,
      prompt: [
        `Translate each of the following ${segments.length} subtitle lines to ${targetLanguage}.`,
        "Return exactly one translated line per input line, in the same order. Do not merge, split, or skip any.",
        "Lines:",
        segments.map((s, i) => `${i + 1}. ${s.text}`).join("\n"),
      ].join("\n\n"),
    });
    if (result.object.translations.length !== segments.length) {
      throw new Error(
        `Expected ${segments.length} translations, got ${result.object.translations.length}`,
      );
    }
    return result;
  });

  const translated = segments.map((s, i) => ({ ...s, text: object.translations[i] }));
  const alignment = validateTranslatedAlignment(segments, translated);
  if (!alignment.ok) throw new Error(alignment.reason);
  return translated;
}

export async function POST(req: Request) {
  if (
    !WORKER_INTERNAL_SECRET ||
    req.headers.get("x-worker-secret") !== WORKER_INTERNAL_SECRET
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = (await req.json()) as { projectId: string };
  const db = getDb();

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const targetLanguage = project.options.targetLanguage;
  if (!targetLanguage) {
    // No target language selected for this project — translate is a no-op.
    return NextResponse.json({ ok: true, skipped: true, count: 0 });
  }

  const [transcript] = await db
    .select()
    .from(transcripts)
    .where(eq(transcripts.projectId, projectId));
  if (!transcript) {
    return NextResponse.json({ error: "No transcript for this project yet." }, { status: 400 });
  }

  const projectClips = await db.select().from(clips).where(eq(clips.projectId, projectId));

  let succeeded = 0;
  for (const clip of projectClips) {
    const clipSegments = transcript.segments.filter(
      (s) => s.start >= clip.startS && s.start < clip.endS,
    );
    if (clipSegments.length === 0) continue;

    try {
      const translated = await translateSegments(clipSegments, targetLanguage);
      await db
        .update(clips)
        .set({ translatedSegments: translated })
        .where(eq(clips.id, clip.id));
      succeeded += 1;
    } catch (err) {
      console.error(`Translation failed for clip ${clip.id}:`, err);
    }
  }

  if (succeeded === 0 && projectClips.length > 0) {
    return NextResponse.json({ error: "Translation failed for every clip." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: succeeded });
}
