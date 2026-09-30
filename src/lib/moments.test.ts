import { describe, expect, it } from "vitest";
import {
  MIN_CLIP_SCORE,
  dedupCandidates,
  selectClips,
  snapCandidate,
  snapToWordBoundary,
  type MomentCandidate,
} from "./moments";
import type { TranscriptWord } from "@/db/schema";

const words: TranscriptWord[] = [
  { word: "Hello", start: 10.0, end: 10.4 },
  { word: "there", start: 10.4, end: 10.9 },
  { word: "friend", start: 10.9, end: 11.5 },
  { word: "goodbye", start: 20.0, end: 20.6 },
];

function candidate(overrides: Partial<MomentCandidate> = {}): MomentCandidate {
  return {
    start: 10.2,
    end: 20.3,
    title: "Test clip",
    hashtags: ["#test"],
    score: 80,
    subScores: { hook: 80, flow: 80, value: 80, trend: 80 },
    reason: "because",
    ...overrides,
  };
}

describe("snapToWordBoundary", () => {
  it("snaps a start time to the nearest word start", () => {
    expect(snapToWordBoundary(10.3, words, "start")).toBe(10.4);
  });

  it("snaps an end time to the nearest word end", () => {
    expect(snapToWordBoundary(20.4, words, "end")).toBe(20.6);
  });

  it("returns the input unchanged when there are no words", () => {
    expect(snapToWordBoundary(5, [], "start")).toBe(5);
  });
});

describe("snapCandidate", () => {
  it("snaps both edges of a candidate (FR-14 — no mid-word cuts)", () => {
    const snapped = snapCandidate(candidate({ start: 10.3, end: 20.4 }), words);
    expect(snapped.start).toBe(10.4);
    expect(snapped.end).toBe(20.6);
  });
});

describe("dedupCandidates", () => {
  it("keeps the higher-scoring candidate when two overlap heavily", () => {
    const weak = candidate({ start: 0, end: 30, score: 50 });
    const strong = candidate({ start: 5, end: 32, score: 90 });
    const result = dedupCandidates([weak, strong]);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(90);
  });

  it("keeps both candidates when they barely overlap", () => {
    const a = candidate({ start: 0, end: 20, score: 60 });
    const b = candidate({ start: 19, end: 40, score: 60 });
    expect(dedupCandidates([a, b], 0.5)).toHaveLength(2);
  });

  it("returns candidates sorted by start time", () => {
    const a = candidate({ start: 50, end: 60, score: 70 });
    const b = candidate({ start: 0, end: 10, score: 70 });
    const result = dedupCandidates([a, b]);
    expect(result.map((c) => c.start)).toEqual([0, 50]);
  });
});

describe("selectClips", () => {
  it("drops candidates below the minimum score threshold", () => {
    const weak = candidate({ start: 0, end: 40, score: MIN_CLIP_SCORE - 1 });
    const strong = candidate({ start: 100, end: 140, score: 90 });
    const result = selectClips([weak, strong], { clipLength: "medium", maxClips: 8 });
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(90);
  });

  it("caps results at maxClips, keeping the highest scores", () => {
    const candidates = [90, 80, 70, 60].map((score, i) =>
      candidate({ start: i * 100, end: i * 100 + 40, score }),
    );
    const result = selectClips(candidates, { clipLength: "medium", maxClips: 2 });
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.score).sort((a, b) => b - a)).toEqual([90, 80]);
  });

  it("prefers candidates within the requested clip-length range", () => {
    const tooShort = candidate({ start: 0, end: 5, score: 95 }); // 5s, way under "medium" (30-60s)
    const goodLength = candidate({ start: 100, end: 140, score: 41 }); // 40s
    const result = selectClips([tooShort, goodLength], {
      clipLength: "medium",
      maxClips: 8,
    });
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe(100);
  });

  it("falls back to all candidates if none match the length range", () => {
    const onlyShort = candidate({ start: 0, end: 5, score: 90 });
    const result = selectClips([onlyShort], { clipLength: "medium", maxClips: 8 });
    expect(result).toHaveLength(1);
  });
});
