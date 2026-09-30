import { describe, expect, it } from "vitest";
import { estimateLlmCostUsd } from "./pricing";

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
