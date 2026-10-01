// M7.2/NFR cost control: rough per-job LLM cost from AI SDK token usage.
// [ASSUMPTION] list-price approximations, not pulled from a live pricing
// API — see docs/DECISIONS.md. Kept per-provider since the two in use
// (Claude Sonnet via AI Gateway, Gemini Flash direct) differ by >10x.
const CLAUDE_INPUT_COST_PER_1K_TOKENS = 0.003;
const CLAUDE_OUTPUT_COST_PER_1K_TOKENS = 0.015;

// Gemini Flash-tier pricing is much cheaper than Claude Sonnet — using the
// Claude rate here would wildly overstate the real cost of translation jobs.
const GEMINI_FLASH_INPUT_COST_PER_1K_TOKENS = 0.0001;
const GEMINI_FLASH_OUTPUT_COST_PER_1K_TOKENS = 0.0004;

type TokenUsage = { inputTokens?: number; outputTokens?: number };

function estimateCostUsd(
  usage: TokenUsage,
  inputRatePer1k: number,
  outputRatePer1k: number,
): number {
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  return (input / 1000) * inputRatePer1k + (output / 1000) * outputRatePer1k;
}

/** Claude Sonnet via AI Gateway (detect-moments). */
export function estimateLlmCostUsd(usage: TokenUsage): number {
  return estimateCostUsd(usage, CLAUDE_INPUT_COST_PER_1K_TOKENS, CLAUDE_OUTPUT_COST_PER_1K_TOKENS);
}

/** Gemini Flash direct — now only the fallback path (see llm-json.ts). */
export function estimateGeminiCostUsd(usage: TokenUsage): number {
  return estimateCostUsd(
    usage,
    GEMINI_FLASH_INPUT_COST_PER_1K_TOKENS,
    GEMINI_FLASH_OUTPUT_COST_PER_1K_TOKENS,
  );
}

/** Groq direct (translate-subtitles, shorten-text, detect-moments — primary
 * path). Always $0: the free tier has no card on file, so going over a
 * limit gets rate-limited (429), never billed. Revisit if the user ever
 * adds Groq billing. */
export function estimateGroqCostUsd(): number {
  return 0;
}

/** Dispatches on a `LanguageModel`'s `.provider` id (e.g. "groq.chat",
 * "google.generative-ai") so call sites using `withModelFallback` /
 * `generateJsonTextWithFallback` don't need to track which model in the
 * fallback list actually answered. */
export function estimateCostUsdForProvider(provider: string, usage: TokenUsage): number {
  if (provider.startsWith("groq")) return estimateGroqCostUsd();
  if (provider.startsWith("google")) return estimateGeminiCostUsd(usage);
  return 0;
}
