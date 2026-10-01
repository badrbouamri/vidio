import { NextResponse } from "next/server";
import { z } from "zod";
import { generateJsonTextWithFallback } from "@/lib/llm-json";
import { TEXT_MODELS } from "@/lib/llm-models";

// M6.2 edge case §11: "shorten the translation and regenerate" — called by
// worker/dub.py when even max-stretch TTS wouldn't fit a segment's audio.
// Part of the translation feature, so it uses the same Groq-primary/
// Gemini-fallback models as translate-subtitles — see docs/DECISIONS.md.
const WORKER_INTERNAL_SECRET = process.env.WORKER_INTERNAL_SECRET;

const schema = z.object({ text: z.string() });

export async function POST(req: Request) {
  if (
    !WORKER_INTERNAL_SECRET ||
    req.headers.get("x-worker-secret") !== WORKER_INTERNAL_SECRET
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { text, targetLanguage } = (await req.json()) as {
    text: string;
    targetLanguage: string;
  };
  if (!text || !targetLanguage) {
    return NextResponse.json({ error: "text and targetLanguage are required" }, { status: 400 });
  }

  // Plain generateText + manual JSON parse, not generateObject — see
  // docs/DECISIONS.md (Gemini structured-output mode observed 503ing).
  const { data } = await generateJsonTextWithFallback(
    TEXT_MODELS,
    [
      `The following ${targetLanguage} subtitle line is too long to be spoken within its time slot.`,
      "Rewrite it noticeably shorter while keeping the same meaning and language.",
      'Respond with ONLY a JSON object of this exact shape, no markdown fences, no other text: {"text": "..."}',
      `Line: ${text}`,
    ].join("\n\n"),
    schema,
  );

  return NextResponse.json({ text: data.text });
}
