import { describe, expect, it } from "vitest";
import { clipLengthBucket, filterClips, sortByScoreDesc, type GalleryClip } from "./gallery";

function clip(overrides: Partial<GalleryClip> = {}): GalleryClip {
  return {
    id: "c1",
    startS: 0,
    endS: 40,
    title: "Test",
    hashtags: [],
    score: 50,
    status: "ready",
    thumbnailUrl: null,
    ...overrides,
  };
}

describe("clipLengthBucket", () => {
  it("buckets a 20s clip as short", () => {
    expect(clipLengthBucket(0, 20)).toBe("short");
  });
  it("buckets a 45s clip as medium", () => {
    expect(clipLengthBucket(0, 45)).toBe("medium");
  });
  it("buckets a 75s clip as long", () => {
    expect(clipLengthBucket(0, 75)).toBe("long");
  });
});

describe("filterClips", () => {
  const clips = [
    clip({ id: "a", startS: 0, endS: 20, score: 90 }), // short, high score
    clip({ id: "b", startS: 0, endS: 45, score: 30 }), // medium, low score
    clip({ id: "c", startS: 0, endS: 80, score: 60 }), // long, mid score
  ];

  it("returns everything with no filters", () => {
    expect(filterClips(clips, {})).toHaveLength(3);
  });

  it("filters by length bucket", () => {
    const result = filterClips(clips, { length: "medium" });
    expect(result.map((c) => c.id)).toEqual(["b"]);
  });

  it("filters by minimum score", () => {
    const result = filterClips(clips, { minScore: 60 });
    expect(result.map((c) => c.id).sort()).toEqual(["a", "c"]);
  });

  it("combines both filters", () => {
    const result = filterClips(clips, { length: "long", minScore: 50 });
    expect(result.map((c) => c.id)).toEqual(["c"]);
  });
});

describe("sortByScoreDesc", () => {
  it("sorts highest score first without mutating the input", () => {
    const clips = [clip({ id: "a", score: 10 }), clip({ id: "b", score: 90 })];
    const sorted = sortByScoreDesc(clips);
    expect(sorted.map((c) => c.id)).toEqual(["b", "a"]);
    expect(clips.map((c) => c.id)).toEqual(["a", "b"]); // original untouched
  });
});
