import type { ClipSubScores, ProjectOptions, TranscriptWord } from "@/db/schema";
import { CLIP_LENGTH_RANGES } from "@/lib/video-validation";

// Edge case §11: "LLM returns fewer clips than requested → show what exists,
// no padding with weak clips (min score threshold, e.g., 40)."
export const MIN_CLIP_SCORE = 40;

export type MomentCandidate = {
  start: number;
  end: number;
  title: string;
  hashtags: string[];
  score: number;
  subScores: ClipSubScores;
  reason: string;
};

// FR-14: snap segment boundaries to word boundaries so no clip starts or
// ends mid-word.
export function snapToWordBoundary(
  timeS: number,
  words: TranscriptWord[],
  edge: "start" | "end",
): number {
  if (words.length === 0) return timeS;
  let best = words[0];
  let bestDist = Infinity;
  for (const word of words) {
    const point = edge === "start" ? word.start : word.end;
    const dist = Math.abs(point - timeS);
    if (dist < bestDist) {
      bestDist = dist;
      best = word;
    }
  }
  return edge === "start" ? best.start : best.end;
}

export function snapCandidate(
  candidate: MomentCandidate,
  words: TranscriptWord[],
): MomentCandidate {
  return {
    ...candidate,
    start: snapToWordBoundary(candidate.start, words, "start"),
    end: snapToWordBoundary(candidate.end, words, "end"),
  };
}

function overlapRatio(a: MomentCandidate, b: MomentCandidate): number {
  const overlapStart = Math.max(a.start, b.start);
  const overlapEnd = Math.min(a.end, b.end);
  const overlap = Math.max(0, overlapEnd - overlapStart);
  const shorterLen = Math.min(a.end - a.start, b.end - b.start);
  if (shorterLen <= 0) return 0;
  return overlap / shorterLen;
}

// FR-15: deduplicate overlapping candidates, keeping the higher-scoring one
// whenever two candidates overlap more than `overlapThreshold` of the
// shorter candidate's length.
export function dedupCandidates(
  candidates: MomentCandidate[],
  overlapThreshold = 0.5,
): MomentCandidate[] {
  const byScoreDesc = [...candidates].sort((a, b) => b.score - a.score);
  const kept: MomentCandidate[] = [];
  for (const candidate of byScoreDesc) {
    const overlapsKept = kept.some(
      (k) => overlapRatio(candidate, k) > overlapThreshold,
    );
    if (!overlapsKept) kept.push(candidate);
  }
  return kept.sort((a, b) => a.start - b.start);
}

// FR-15 + edge case §11: respect the user's clip-length preference and
// max-clip count; drop below-threshold candidates rather than padding with
// weak ones.
export function selectClips(
  candidates: MomentCandidate[],
  options: Pick<ProjectOptions, "clipLength" | "maxClips">,
): MomentCandidate[] {
  const [minLen, maxLen] = CLIP_LENGTH_RANGES[options.clipLength ?? "medium"];
  const inRange = candidates.filter((c) => {
    const len = c.end - c.start;
    return len >= minLen * 0.8 && len <= maxLen * 1.2;
  });
  const pool = inRange.length > 0 ? inRange : candidates;
  const aboveThreshold = pool.filter((c) => c.score >= MIN_CLIP_SCORE);

  const deduped = dedupCandidates(aboveThreshold);
  return [...deduped]
    .sort((a, b) => b.score - a.score)
    .slice(0, options.maxClips ?? 8)
    .sort((a, b) => a.start - b.start);
}
