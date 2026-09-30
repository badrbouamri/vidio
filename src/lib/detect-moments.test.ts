import { describe, expect, it, vi } from "vitest";
import { chunkSegments, withRetries } from "./detect-moments";
import type { TranscriptSegment } from "@/db/schema";

function segment(start: number, end: number): TranscriptSegment {
  return { start, end, text: `segment ${start}` };
}

describe("chunkSegments", () => {
  it("returns an empty array for no segments", () => {
    expect(chunkSegments([])).toEqual([]);
  });

  it("keeps segments within the window in one chunk", () => {
    const segments = [segment(0, 10), segment(100, 110), segment(590, 600)];
    expect(chunkSegments(segments, 600)).toHaveLength(1);
  });

  it("starts a new chunk once the window is exceeded", () => {
    const segments = [segment(0, 10), segment(700, 710)];
    const chunks = chunkSegments(segments, 600);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual([segments[0]]);
    expect(chunks[1]).toEqual([segments[1]]);
  });

  it("never splits a single segment across chunks", () => {
    const segments = [segment(0, 5), segment(10, 20), segment(650, 660)];
    const chunks = chunkSegments(segments, 600);
    const total = chunks.reduce((n, c) => n + c.length, 0);
    expect(total).toBe(segments.length);
  });
});

describe("withRetries", () => {
  it("returns the result on the first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    expect(await withRetries(fn, 2)).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and returns the eventual success (FR-16)", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("invalid schema"))
      .mockRejectedValueOnce(new Error("invalid schema"))
      .mockResolvedValueOnce("ok");
    expect(await withRetries(fn, 2)).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws the last error after exhausting retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("still invalid"));
    await expect(withRetries(fn, 2)).rejects.toThrow("still invalid");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
