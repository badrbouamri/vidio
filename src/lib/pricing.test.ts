import { describe, expect, it } from "vitest";
import { estimateGeminiCostUsd, estimateLlmCostUsd } from "./pricing";

describe("estimateLlmCostUsd", () => {
  it("computes cost from input and output tokens", () => {
    const cost = estimateLlmCostUsd({ inputTokens: 1000, outputTokens: 1000 });
    expect(cost).toBeCloseTo(0.003 + 0.015, 6);
  });

  it("treats missing token counts as zero", () => {
    expect(estimateLlmCostUsd({})).toBe(0);
  });

  it("scales linearly", () => {
    const single = estimateLlmCostUsd({ inputTokens: 500, outputTokens: 0 });
    const double = estimateLlmCostUsd({ inputTokens: 1000, outputTokens: 0 });
    expect(double).toBeCloseTo(single * 2, 6);
  });
});

describe("estimateGeminiCostUsd", () => {
  it("is much cheaper than the Claude rate for the same usage", () => {
    const usage = { inputTokens: 1000, outputTokens: 1000 };
    expect(estimateGeminiCostUsd(usage)).toBeLessThan(estimateLlmCostUsd(usage) / 10);
  });

  it("treats missing token counts as zero", () => {
    expect(estimateGeminiCostUsd({})).toBe(0);
  });
});
