import type { ValidationResult } from "@/lib/video-validation";

// FR-30: trim handles bounded to ±30s of the *original* LLM-detected
// segment (not the current, possibly-already-trimmed start/end — repeated
// trims must not let a clip creep arbitrarily far from where it started).
export const MAX_TRIM_DELTA_S = 30;

export function validateTrim(
  originalStartS: number,
  originalEndS: number,
  newStartS: number,
  newEndS: number,
  sourceDurationS?: number,
  maxDeltaS: number = MAX_TRIM_DELTA_S,
): ValidationResult {
  if (newStartS >= newEndS) {
    return { ok: false, reason: "Start must be before end." };
  }
  if (newStartS < originalStartS - maxDeltaS) {
    return {
      ok: false,
      reason: `Start can't move more than ${maxDeltaS}s before the original clip.`,
    };
  }
  if (newEndS > originalEndS + maxDeltaS) {
    return {
      ok: false,
      reason: `End can't move more than ${maxDeltaS}s past the original clip.`,
    };
  }
  if (newStartS < 0) {
    return { ok: false, reason: "Start can't be before the beginning of the source." };
  }
  if (sourceDurationS !== undefined && newEndS > sourceDurationS) {
    return { ok: false, reason: "End can't be past the end of the source video." };
  }
  return { ok: true };
}
