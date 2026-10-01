import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clips, projects, transcripts, type TranscriptSegment } from "@/db/schema";
import { withRetries } from "@/lib/detect-moments";
import { validateTranslatedAlignment } from "@/lib/dubbing";
import { estimateGeminiCostUsd } from "@/lib/pricing";
import { log } from "@/lib/log";

// Machine-to-machine route — same pattern as /api/internal/detect-moments
// (LLM calls live here, not in the Python worker — see docs/DECISIONS.md).
const WORKER_INTERNAL_SECRET = process.env.WORKER_INTERNAL_SECRET;

// Translation (only) runs on Gemini direct, via a user-supplied free-tier
// key (GOOGLE_GENERATIVE_AI_API_KEY) — not through AI Gateway, since the
// point is to use that key's own quota rather than Gateway credits. Moment
// detection (detect-moments) stays on Claude via Gateway. See
// docs/DECISIONS.md.
const TRANSLATION_MODEL = google("gemini-3.8-flash");

const translationSchema = z.object({ translations: z.array(z.string()) });

// FR-25: translate each segment's text; timing is never entrusted to the
// model at all — we zip its translated strings back onto the ORIGINAL
// segments' start/end ourselves, so "timing kept aligned per segment" holds
// by construction, not by hoping the model echoes numbers correctly.
async function translateSegments(
  segments: TranscriptSegment[],
  targetLanguage: string,
): Promise<{ segments: TranscriptSegment[]; costUsd: number }> {
  const { object, usage } = await withRetries(async () => {
    const result = await generateObject({
      model: TRANSLATION_MODEL,
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
  return { segments: translated, costUsd: estimateGeminiCostUsd(usage) };
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
  let costUsd = 0;
  for (const clip of projectClips) {
    const clipSegments = transcript.segments.filter(
      (s) => s.start >= clip.startS && s.start < clip.endS,
    );
    if (clipSegments.length === 0) continue;

    try {
      const result = await translateSegments(clipSegments, targetLanguage);
      await db
        .update(clips)
        .set({ translatedSegments: result.segments })
        .where(eq(clips.id, clip.id));
      succeeded += 1;
      costUsd += result.costUsd;
    } catch (err) {
      log.error("translate.clip_failed", err, { clipId: clip.id, projectId });
    }
  }

  if (succeeded === 0 && projectClips.length > 0) {
    return NextResponse.json({ error: "Translation failed for every clip." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: succeeded, costUsd });
}
