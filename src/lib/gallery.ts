import { CLIP_LENGTH_RANGES } from "@/lib/video-validation";

export type GalleryClip = {
  id: string;
  startS: number;
  endS: number;
  title: string;
  hashtags: string[];
  score: number;
  status: string;
  thumbnailUrl: string | null;
};

export type LengthFilter = "all" | "short" | "medium" | "long";

// M4.8: cards sorted by score, filters (length/score). Bucket boundaries
// mirror CLIP_LENGTH_RANGES (video-validation.ts) so the gallery's language
// matches the New Project form's clip-length options.
export function clipLengthBucket(startS: number, endS: number): "short" | "medium" | "long" {
  const durationS = endS - startS;
  if (durationS <= CLIP_LENGTH_RANGES.short[1]) return "short";
  if (durationS <= CLIP_LENGTH_RANGES.medium[1]) return "medium";
  return "long";
}

export function filterClips(
  clips: GalleryClip[],
  { length = "all", minScore = 0 }: { length?: LengthFilter; minScore?: number },
): GalleryClip[] {
  return clips.filter((c) => {
    if (length !== "all" && clipLengthBucket(c.startS, c.endS) !== length) return false;
    if (c.score < minScore) return false;
    return true;
  });
}

export function sortByScoreDesc(clips: GalleryClip[]): GalleryClip[] {
  return [...clips].sort((a, b) => b.score - a.score);
}
