import { describe, expect, it } from "vitest";
import {
  canUseVoiceCloning,
  validateTranslatedAlignment,
  SUPPORTED_TARGET_LANGUAGES,
} from "./dubbing";
import type { TranscriptSegment } from "@/db/schema";

describe("canUseVoiceCloning", () => {
  it("blocks when neither flag is set", () => {
    expect(canUseVoiceCloning({})).toBe(false);
  });

  it("blocks when enabled but not consented (FR-26: opt-in requires explicit consent)", () => {
    expect(canUseVoiceCloning({ voiceCloningEnabled: true })).toBe(false);
  });

  it("blocks when consented but not actually enabled", () => {
    expect(canUseVoiceCloning({ voiceCloningConsent: true })).toBe(false);
  });

  it("allows only when both are true", () => {
    expect(
      canUseVoiceCloning({ voiceCloningEnabled: true, voiceCloningConsent: true }),
    ).toBe(true);
  });
});

describe("SUPPORTED_TARGET_LANGUAGES", () => {
  it("covers the FR-28 v1 language list", () => {
    const codes = SUPPORTED_TARGET_LANGUAGES.map((l) => l.code);
    expect(codes).toEqual(["en", "fr", "ar", "de", "es"]);
  });
});

describe("validateTranslatedAlignment", () => {
  const original: TranscriptSegment[] = [
    { start: 0, end: 1.5, text: "Hello" },
    { start: 1.5, end: 3, text: "world" },
  ];

  it("accepts a translation with matching segment count and timing", () => {
    const translated: TranscriptSegment[] = [
      { start: 0, end: 1.5, text: "Bonjour" },
      { start: 1.5, end: 3, text: "monde" },
    ];
    expect(validateTranslatedAlignment(original, translated)).toEqual({ ok: true });
  });

  it("rejects a mismatched segment count", () => {
    const result = validateTranslatedAlignment(original, [
      { start: 0, end: 1.5, text: "Bonjour" },
    ]);
    expect(result.ok).toBe(false);
  });

  it("rejects drifted timing", () => {
    const translated: TranscriptSegment[] = [
      { start: 0, end: 1.5, text: "Bonjour" },
      { start: 1.6, end: 3, text: "monde" }, // start drifted
    ];
    const result = validateTranslatedAlignment(original, translated);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Segment 1/);
  });

  it("rejects empty translated text", () => {
    const translated: TranscriptSegment[] = [
      { start: 0, end: 1.5, text: "" },
      { start: 1.5, end: 3, text: "monde" },
    ];
    const result = validateTranslatedAlignment(original, translated);
    expect(result.ok).toBe(false);
  });

  it("tolerates trivial floating-point timing noise", () => {
    const translated: TranscriptSegment[] = [
      { start: 0.001, end: 1.5, text: "Bonjour" },
      { start: 1.5, end: 3.0001, text: "monde" },
    ];
    expect(validateTranslatedAlignment(original, translated)).toEqual({ ok: true });
  });
});
