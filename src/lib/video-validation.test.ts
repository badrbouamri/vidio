import { describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  isYoutubeUrl,
  validateDuration,
  validateFileMeta,
} from "./video-validation";

describe("validateFileMeta", () => {
  it("accepts an allowed type under the size limit", () => {
    expect(validateFileMeta({ type: "video/mp4", size: 1024 })).toEqual({
      ok: true,
    });
  });

  it("rejects a disallowed mime type with a readable reason", () => {
    const result = validateFileMeta({ type: "video/avi", size: 1024 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Unsupported format/);
  });

  it("rejects a file over the size cap", () => {
    const result = validateFileMeta({
      type: "video/mp4",
      size: MAX_UPLOAD_BYTES + 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/larger than/);
  });
});

describe("validateDuration", () => {
  it("accepts durations under the cap", () => {
    expect(validateDuration(60)).toEqual({ ok: true });
  });

  it("rejects durations over the cap with a readable reason", () => {
    const result = validateDuration(3 * 60 * 60 + 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/longer than/);
  });
});

describe("isYoutubeUrl", () => {
  it("accepts standard watch URLs", () => {
    expect(isYoutubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      true,
    );
  });

  it("accepts youtu.be short URLs", () => {
    expect(isYoutubeUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
  });

  it("rejects non-YouTube URLs", () => {
    expect(isYoutubeUrl("https://vimeo.com/12345")).toBe(false);
  });
});
