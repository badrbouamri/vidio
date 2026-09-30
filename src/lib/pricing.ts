// M7.2/NFR cost control: rough per-job LLM cost from AI SDK token usage.
// [ASSUMPTION] blended rate approximating Claude Sonnet list pricing, not
// pulled from a live pricing API — see docs/DECISIONS.md.
const INPUT_COST_PER_1K_TOKENS = 0.003;
const OUTPUT_COST_PER_1K_TOKENS = 0.015;

export function estimateLlmCostUsd(usage: {
  inputTokens?: number;
  outputTokens?: number;
}): number {
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  return (input / 1000) * INPUT_COST_PER_1K_TOKENS + (output / 1000) * OUTPUT_COST_PER_1K_TOKENS;
}
