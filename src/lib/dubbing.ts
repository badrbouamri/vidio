import type { ProjectOptions, TranscriptSegment } from "@/db/schema";

// FR-28: supported dubbing/translation target languages in v1.
export const SUPPORTED_TARGET_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "fr", label: "French" },
  { code: "ar", label: "Arabic (MSA)" },
  { code: "de", label: "German" },
  { code: "es", label: "Spanish" },
] as const;

// FR-26 assumption: voice cloning is off by default and requires explicit,
// separate consent — enabling it alone is not enough. No voice-cloning
// provider is actually wired up yet (see docs/DECISIONS.md); this gate
// exists so that whenever one is, it's impossible to call it without both
// flags true.
export function canUseVoiceCloning(options: Pick<ProjectOptions, "voiceCloningEnabled" | "voiceCloningConsent">): boolean {
  return Boolean(options.voiceCloningEnabled) && Boolean(options.voiceCloningConsent);
}

export type AlignmentResult = { ok: true } | { ok: false; reason: string };

// FR-25: "timing kept aligned per segment" — defends against an LLM
// translation call that reordered, dropped, or renumbered segments instead
// of just translating each one's text in place.
export function validateTranslatedAlignment(
  original: TranscriptSegment[],
  translated: TranscriptSegment[],
): AlignmentResult {
  if (translated.length !== original.length) {
    return {
      ok: false,
      reason: `Expected ${original.length} translated segments, got ${translated.length}.`,
    };
  }
  for (let i = 0; i < original.length; i++) {
    if (
      Math.abs(translated[i].start - original[i].start) > 0.01 ||
      Math.abs(translated[i].end - original[i].end) > 0.01
    ) {
      return { ok: false, reason: `Segment ${i} timing changed during translation.` };
    }
    if (!translated[i].text.trim()) {
      return { ok: false, reason: `Segment ${i} translated to empty text.` };
    }
  }
  return { ok: true };
}
