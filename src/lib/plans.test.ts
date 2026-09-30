import { describe, expect, it } from "vitest";
import { canStartNewProject, isPeriodExpired, remainingMinutes, PLAN_LIMITS } from "./plans";

describe("remainingMinutes", () => {
  it("returns the full allowance when nothing has been used", () => {
    expect(remainingMinutes("free", 0)).toBe(60);
  });

  it("subtracts usage from the allowance", () => {
    expect(remainingMinutes("free", 45)).toBe(15);
  });

  it("clamps at zero rather than going negative", () => {
    expect(remainingMinutes("free", 100)).toBe(0);
  });

  it("uses the pro plan's higher allowance", () => {
    expect(remainingMinutes("pro", 100)).toBe(PLAN_LIMITS.pro.minutesPerMonth - 100);
  });
});

describe("canStartNewProject", () => {
  it("allows starting when minutes remain", () => {
    expect(canStartNewProject("free", 59)).toBe(true);
  });

  it("blocks once minutes are fully used (edge case §11)", () => {
    expect(canStartNewProject("free", 60)).toBe(false);
  });

  it("blocks when usage has gone past the allowance", () => {
    expect(canStartNewProject("free", 75)).toBe(false);
  });
});

describe("PLAN_LIMITS", () => {
  it("free tier has a watermark, 720p cap, and no dubbing (FR-40)", () => {
    expect(PLAN_LIMITS.free.watermark).toBe(true);
    expect(PLAN_LIMITS.free.maxHeight).toBe(720);
    expect(PLAN_LIMITS.free.dubbingAllowed).toBe(false);
  });

  it("pro tier has no watermark, 1080p, and dubbing enabled (FR-41)", () => {
    expect(PLAN_LIMITS.pro.watermark).toBe(false);
    expect(PLAN_LIMITS.pro.maxHeight).toBe(1080);
    expect(PLAN_LIMITS.pro.dubbingAllowed).toBe(true);
  });
});

describe("isPeriodExpired", () => {
  it("is not expired right after reset", () => {
    const now = new Date("2026-02-15T00:00:00Z");
    const resetAt = new Date("2026-02-01T00:00:00Z");
    expect(isPeriodExpired(resetAt, now)).toBe(false);
  });

  it("is expired a month or more later", () => {
    const now = new Date("2026-03-05T00:00:00Z");
    const resetAt = new Date("2026-02-01T00:00:00Z");
    expect(isPeriodExpired(resetAt, now)).toBe(true);
  });
});
