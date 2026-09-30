import { describe, expect, it } from "vitest";
import { MAX_TRIM_DELTA_S, validateTrim } from "./trim";

describe("validateTrim", () => {
  const originalStart = 100;
  const originalEnd = 140; // 40s clip

  it("accepts a trim within bounds", () => {
    expect(validateTrim(originalStart, originalEnd, 90, 150)).toEqual({ ok: true });
  });

  it("accepts the original bounds unchanged", () => {
    expect(validateTrim(originalStart, originalEnd, originalStart, originalEnd)).toEqual({
      ok: true,
    });
  });

  it("rejects start >= end", () => {
    const result = validateTrim(originalStart, originalEnd, 120, 110);
    expect(result.ok).toBe(false);
  });

  it(`rejects start more than ${MAX_TRIM_DELTA_S}s before the original`, () => {
    const result = validateTrim(originalStart, originalEnd, originalStart - 31, originalEnd);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/before the original/);
  });

  it(`accepts start exactly ${MAX_TRIM_DELTA_S}s before the original`, () => {
    expect(
      validateTrim(originalStart, originalEnd, originalStart - MAX_TRIM_DELTA_S, originalEnd),
    ).toEqual({ ok: true });
  });

  it(`rejects end more than ${MAX_TRIM_DELTA_S}s past the original`, () => {
    const result = validateTrim(originalStart, originalEnd, originalStart, originalEnd + 31);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/past the original/);
  });

  it("rejects a negative start", () => {
    const result = validateTrim(5, 40, -1, 30);
    expect(result.ok).toBe(false);
  });

  it("rejects an end past the source duration when provided", () => {
    const result = validateTrim(originalStart, originalEnd, originalStart, originalEnd, 130);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/past the end of the source/);
  });

  it("ignores the source-duration check when not provided", () => {
    expect(validateTrim(originalStart, originalEnd, originalStart, originalEnd)).toEqual({
      ok: true,
    });
  });
});
