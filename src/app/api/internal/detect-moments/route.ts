import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clips, projects, transcripts, type TranscriptSegment } from "@/db/schema";
import {
  chunkSegments,
  withRetries,
} from "@/lib/detect-moments";
import { selectClips, snapCandidate, type MomentCandidate } from "@/lib/moments";
import { estimateLlmCostUsd } from "@/lib/pricing";

// Machine-to-machine route — the worker calls this (not a browser), so it's
// authenticated with a shared secret instead of a Clerk session. Deliberately
// outside the `/api/projects(.*)` matcher in proxy.ts.
const WORKER_INTERNAL_SECRET = process.env.WORKER_INTERNAL_SECRET;

// Mirrors the PRD §9 LLM moment-detection output schema exactly (field
// names, not the app's camelCase — this is what the model is prompted for).
const candidateSchema = z.object({
  start: z.number(),
  end: z.number(),
  title: z.string(),
  hashtags: z.array(z.string()),
  score: z.number().min(0).max(100),
  sub_scores: z.object({
    hook: z.number().min(0).max(100),
    flow: z.number().min(0).max(100),
    value: z.number().min(0).max(100),
    trend: z.number().min(0).max(100),
  }),
  reason: z.string(),
});

const responseSchema = z.object({ clips: z.array(candidateSchema) });

// FR-12/FR-13: chunked transcript -> candidate segments with sub-scores,
// title, hashtags, reason. See docs/DECISIONS.md — the LLM call lives here
// (Next.js + AI Gateway) rather than in the Python worker, since the AI SDK
// / Gateway is TS-native.
async function detectChunk(
  chunk: TranscriptSegment[],
  clipLength: string,
): Promise<{ candidates: MomentCandidate[]; costUsd: number }> {
  const transcriptText = chunk
    .map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`)
    .join("\n");

  const { object, usage } = await withRetries(() =>
    generateObject({
      model: "anthropic/claude-sonnet-4.6",
      schema: responseSchema,
      prompt: [
        "You find short, self-contained, highly shareable moments in a video transcript for social clips (TikTok/Reels/Shorts).",
        `Target clip length: ${clipLength}.`,
        "Each candidate must have a clear hook, a complete thought, and a strong ending. Use the exact timestamps from the transcript below.",
        "Score 0-100 overall plus sub-scores for hook, flow, value, trend.",
        "Transcript (seconds):",
        transcriptText,
      ].join("\n\n"),
    }),
  );

  return {
    candidates: object.clips.map((c) => ({
      start: c.start,
      end: c.end,
      title: c.title,
      hashtags: c.hashtags,
      score: c.score,
      subScores: c.sub_scores,
      reason: c.reason,
    })),
    costUsd: estimateLlmCostUsd(usage),
  };
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

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const [transcript] = await db
    .select()
    .from(transcripts)
    .where(eq(transcripts.projectId, projectId));
  if (!transcript) {
    return NextResponse.json(
      { error: "No transcript for this project yet." },
      { status: 400 },
    );
  }

  const clipLength = project.options.clipLength ?? "medium";
  const chunks = chunkSegments(transcript.segments);

  const chunkResults = await Promise.all(
    chunks.map((chunk) => detectChunk(chunk, clipLength)),
  );
  const candidates = chunkResults.flatMap((r) => r.candidates);
  const costUsd = chunkResults.reduce((sum, r) => sum + r.costUsd, 0);

  const snapped = candidates.map((c) => snapCandidate(c, transcript.words));
  const selected = selectClips(snapped, project.options);

  // Edge case §11: fewer clips than requested is fine — never pad with weak
  // clips. Zero clips above threshold is the one truly empty case.
  if (selected.length === 0) {
    return NextResponse.json(
      { error: "No candidate moments scored above the quality threshold." },
      { status: 422 },
    );
  }

  await db.insert(clips).values(
    selected.map((c) => ({
      projectId,
      startS: c.start,
      endS: c.end,
      originalStartS: c.start,
      originalEndS: c.end,
      title: c.title,
      hashtags: c.hashtags,
      score: Math.round(c.score),
      subScores: c.subScores,
      reason: c.reason,
    })),
  );

  return NextResponse.json({ ok: true, count: selected.length, costUsd });
}
