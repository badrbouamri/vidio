import type { TranscriptSegment } from "@/db/schema";

// FR-16: invalid LLM output is retried up to 2 times (3 attempts total).
export const MAX_LLM_RETRIES = 2;

// FR-12: analyze the transcript in chunks rather than one giant prompt.
export const CHUNK_DURATION_S = 10 * 60;

/** Groups segments into ~`maxChunkS`-long windows, never splitting a segment. */
export function chunkSegments(
  segments: TranscriptSegment[],
  maxChunkS = CHUNK_DURATION_S,
): TranscriptSegment[][] {
  if (segments.length === 0) return [];
  const chunks: TranscriptSegment[][] = [];
  let current: TranscriptSegment[] = [];
  let chunkStart = segments[0].start;

  for (const segment of segments) {
    if (current.length > 0 && segment.start - chunkStart > maxChunkS) {
      chunks.push(current);
      current = [];
      chunkStart = segment.start;
    }
    current.push(segment);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Retries a generator up to `maxRetries` times, surfacing the last error if
 * every attempt fails (FR-16). */
export async function withRetries<T>(
  fn: () => Promise<T>,
  maxRetries = MAX_LLM_RETRIES,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}
