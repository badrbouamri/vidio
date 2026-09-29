// PRD FR-4/FR-6 [ASSUMPTION — max size/duration]. Keep in one place so
// client-side (pre-upload) and server-side (post-upload) checks agree.

export const ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime", // .mov
  "video/x-matroska", // .mkv
  "video/webm",
] as const;

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
export const MAX_DURATION_S = 3 * 60 * 60; // 3 hours

export const CLIP_LENGTH_RANGES = {
  short: [15, 30],
  medium: [30, 60],
  long: [60, 90],
} as const;

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export function validateFileMeta(file: {
  type: string;
  size: number;
}): ValidationResult {
  if (!ALLOWED_VIDEO_TYPES.includes(file.type as (typeof ALLOWED_VIDEO_TYPES)[number])) {
    return {
      ok: false,
      reason: `Unsupported format "${file.type}". Use MP4, MOV, MKV, or WEBM.`,
    };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      reason: `File is larger than the ${MAX_UPLOAD_BYTES / 1024 / 1024 / 1024} GB limit.`,
    };
  }
  return { ok: true };
}

export function validateDuration(durationS: number): ValidationResult {
  if (durationS > MAX_DURATION_S) {
    return {
      ok: false,
      reason: `Video is longer than the ${MAX_DURATION_S / 3600}h limit.`,
    };
  }
  return { ok: true };
}

const YOUTUBE_URL_RE =
  /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{6,}/i;

export function isYoutubeUrl(url: string): boolean {
  return YOUTUBE_URL_RE.test(url.trim());
}
