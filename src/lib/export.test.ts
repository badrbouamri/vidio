import { describe, expect, it } from "vitest";
import { sanitizeClipFilename, uniqueZipFilename } from "./export";

describe("sanitizeClipFilename", () => {
  it("keeps a clean title as-is", () => {
    expect(sanitizeClipFilename("My Cool Clip", "id-1")).toBe("My Cool Clip");
  });

  it("strips unsafe characters", () => {
    expect(sanitizeClipFilename("Wow!! 100% /viral/", "id-1")).toBe("Wow 100 viral");
  });

  it("falls back to the clip id when the title sanitizes to empty", () => {
    expect(sanitizeClipFilename("!!!///", "id-1")).toBe("id-1");
  });
});

describe("uniqueZipFilename", () => {
  it("returns the sanitized name when it's not taken", () => {
    const used = new Set<string>();
    expect(uniqueZipFilename("My Clip", "id-1", used)).toBe("My Clip");
    expect(used.has("My Clip")).toBe(true);
  });

  it("disambiguates a duplicate title with the clip id", () => {
    const used = new Set<string>(["My Clip"]);
    const name = uniqueZipFilename("My Clip", "abcdef1234567890", used);
    expect(name).toBe("My Clip-abcdef12");
    expect(used.has(name)).toBe(true);
  });

  it("never returns the same name for two different clips in the same export", () => {
    const used = new Set<string>();
    const a = uniqueZipFilename("Same Title", "id-aaaaaaaa", used);
    const b = uniqueZipFilename("Same Title", "id-bbbbbbbb", used);
    expect(a).not.toBe(b);
  });
});
