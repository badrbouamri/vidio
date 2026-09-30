import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";

// M6.2 edge case §11: "shorten the translation and regenerate" — called by
// worker/dub.py when even max-stretch TTS wouldn't fit a segment's audio.
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

  const { object } = await generateObject({
    model: "anthropic/claude-sonnet-4.6",
    schema,
    prompt: [
      `The following ${targetLanguage} subtitle line is too long to be spoken within its time slot.`,
      "Rewrite it noticeably shorter while keeping the same meaning and language. Return only the rewritten line.",
      `Line: ${text}`,
    ].join("\n\n"),
  });

  return NextResponse.json({ text: object.text });
}
