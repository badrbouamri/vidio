import { generateText, type LanguageModel } from "ai";
import type { z } from "zod";
import { withRetries, MAX_LLM_RETRIES } from "@/lib/detect-moments";

export { withRetries, MAX_LLM_RETRIES };

// Fallback for providers/models whose structured-output (JSON) mode is
// unavailable or overloaded (observed: Gemini 3.8 Flash 503s on
// generateObject specifically while plain generateText succeeds — see
// docs/DECISIONS.md). Prompts for raw JSON, strips markdown fences if the
// model wraps it in one anyway, parses, and validates against a Zod
// schema — same job generateObject's schema param would have done.
export function extractJsonText(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fenced ? fenced[1] : text).trim();
}

type GenerateTextUsage = Awaited<ReturnType<typeof generateText>>["usage"];

/** One attempt — no retry. Throws on API failure, invalid JSON, or schema
 * mismatch; callers that need extra call-site validation (e.g. "array
 * length must match N") should wrap this (and that check) together in
 * their own `withRetries` so a failure there triggers a fresh generation
 * too, not just a re-validation of the same bad output. */
export async function generateJson<T>(
  params: { model: LanguageModel; prompt: string },
  schema: z.ZodType<T>,
): Promise<{ data: T; usage: GenerateTextUsage }> {
  const result = await generateText(params);
  const jsonText = extractJsonText(result.text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `Model did not return valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const data = schema.parse(parsed);
  return { data, usage: result.usage };
}

/** generateJson + retry (FR-16: invalid output retried up to 2x). Use this
 * when the Zod schema alone fully captures validity; use `generateJson`
 * directly (wrapped in your own `withRetries`) when there's additional
 * call-site validation that should also gate a retry. */
export async function generateJsonText<T>(
  params: { model: LanguageModel; prompt: string },
  schema: z.ZodType<T>,
  maxRetries: number = MAX_LLM_RETRIES,
): Promise<{ data: T; usage: GenerateTextUsage }> {
  return withRetries(() => generateJson(params, schema), maxRetries);
}
