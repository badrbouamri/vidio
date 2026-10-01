"""
M6.2/M6.3: TTS dubbing (FR-26).

Prepares a dubbed audio track per clip: TTS each translated segment, fit it
to the segment's original duration (stretch up to 1.25x, else ask for a
shorter translation and retry — edge case §11), then assemble all segments
into one clip-length track (ffmpeg_filters.py's adelay/amix). Does not
create a ClipVersion itself — render.py picks the cached track up when a
clip's `audio_preference` is "dubbed" (M6.4).

Voice cloning (FR-26 assumption) is gated but not actually implemented —
see can_use_voice_cloning and docs/DECISIONS.md.

TTS provider: edge-tts (free, unofficial — rides Microsoft Edge's
read-aloud service, no API key) is primary; OpenAI's hosted TTS API is an
optional fallback, used only if TTS_API_KEY is set and edge-tts raises.
See docs/DECISIONS.md for the risk tradeoff (unofficial API vs. billed).
"""

import os
import subprocess

import edge_tts
import requests

import ffmpeg_filters as ff
import ingest
from validation import ValidationError

TTS_API_KEY = os.environ.get("TTS_API_KEY")  # optional fallback only
TTS_API_URL = "https://api.openai.com/v1/audio/speech"
TTS_MODEL = "tts-1"
TTS_VOICE = "alloy"  # OpenAI fallback's stock voice — see can_use_voice_cloning

# edge-tts voice per FR-28 target-language code (src/lib/dubbing.ts's
# SUPPORTED_TARGET_LANGUAGES) — one stable, well-known Microsoft neural
# voice per language, same "single stock voice" scope as the OpenAI
# fallback (no cloning, see can_use_voice_cloning).
EDGE_TTS_VOICES = {
    "en": "en-US-AriaNeural",
    "fr": "fr-FR-DeniseNeural",
    "ar": "ar-SA-HamedNeural",
    "de": "de-DE-KatjaNeural",
    "es": "es-ES-ElviraNeural",
}
DEFAULT_EDGE_TTS_VOICE = EDGE_TTS_VOICES["en"]

APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:3000")
WORKER_INTERNAL_SECRET = os.environ.get("WORKER_INTERNAL_SECRET", "")

MAX_STRETCH = 1.25  # edge case §11
MAX_SHORTEN_ATTEMPTS = 2


def can_use_voice_cloning(options: dict) -> bool:
    """FR-26 assumption: off by default, requires explicit separate
    consent. Mirrors src/lib/dubbing.ts's canUseVoiceCloning — no actual
    voice-cloning provider is wired up yet, so this always resolves to
    "use the stock TTS voice" for now; the gate exists for when one is."""
    return bool(options.get("voiceCloningEnabled")) and bool(options.get("voiceCloningConsent"))


def plan_dub_timing(tts_duration_s: float, segment_duration_s: float, max_stretch: float = MAX_STRETCH) -> dict:
    """Returns {"action": "pad"|"stretch"|"shorten", "speed": float|None}."""
    if segment_duration_s <= 0:
        raise ValueError("segment_duration_s must be positive")
    if tts_duration_s <= segment_duration_s:
        return {"action": "pad", "speed": 1.0}
    speed = tts_duration_s / segment_duration_s
    if speed <= max_stretch:
        return {"action": "stretch", "speed": speed}
    return {"action": "shorten", "speed": None}


def fit_segment_audio(
    text: str,
    segment_duration_s: float,
    synthesize,
    shorten,
    max_stretch: float = MAX_STRETCH,
    max_shorten_attempts: int = MAX_SHORTEN_ATTEMPTS,
) -> dict:
    """Tries `text` via `synthesize(text) -> (path, duration_s)`; if the
    result is too long even at `max_stretch`, asks `shorten(text) -> text`
    for a shorter version and retries, up to `max_shorten_attempts` times.
    Falls back to `max_stretch` (best effort) rather than shortening forever
    — matches edge case §11 exactly: "time-stretch up to 1.25x, otherwise
    shorten the translation and regenerate."

    Returns {"path", "action", "speed", "text"}."""
    current_text = text
    for attempt in range(max_shorten_attempts + 1):
        path, duration_s = synthesize(current_text)
        plan = plan_dub_timing(duration_s, segment_duration_s, max_stretch)
        if plan["action"] != "shorten" or attempt == max_shorten_attempts:
            if plan["action"] == "shorten":
                # Ran out of shorten attempts — best-effort cap at max_stretch.
                return {"path": path, "action": "stretch", "speed": max_stretch, "text": current_text}
            return {"path": path, "action": plan["action"], "speed": plan["speed"], "text": current_text}
        current_text = shorten(current_text)
    raise AssertionError("unreachable")  # pragma: no cover


def synthesize_speech_edge_tts(text: str, dest_path: str, target_language: str | None) -> tuple[str, float]:
    """Primary TTS path — free, no API key. `dest_path` ends up holding mp3
    bytes regardless of its extension; ffmpeg/ffprobe sniff the real
    container, so this is fine for the stretch/assembly steps downstream."""
    voice = EDGE_TTS_VOICES.get(target_language or "", DEFAULT_EDGE_TTS_VOICE)
    edge_tts.Communicate(text, voice).save_sync(dest_path)
    duration_s = ingest.probe(dest_path).duration_s
    return dest_path, duration_s


def synthesize_speech_openai(text: str, dest_path: str) -> tuple[str, float]:
    """Fallback TTS path — billed, only reachable when TTS_API_KEY is set."""
    resp = requests.post(
        TTS_API_URL,
        headers={"Authorization": f"Bearer {TTS_API_KEY}"},
        json={"model": TTS_MODEL, "voice": TTS_VOICE, "input": text, "response_format": "wav"},
        timeout=60,
    )
    resp.raise_for_status()
    with open(dest_path, "wb") as f:
        f.write(resp.content)
    duration_s = ingest.probe(dest_path).duration_s
    return dest_path, duration_s


def synthesize_speech(text: str, dest_path: str, target_language: str | None = None) -> tuple[str, float]:
    """Tries edge-tts first; falls back to OpenAI TTS only if TTS_API_KEY is
    set and edge-tts raises (network hiccup, or Microsoft changing/blocking
    the unofficial endpoint — see docs/DECISIONS.md)."""
    try:
        return synthesize_speech_edge_tts(text, dest_path, target_language)
    except Exception:
        if not TTS_API_KEY:
            raise
        return synthesize_speech_openai(text, dest_path)


def request_shorter_translation(text: str, target_language: str) -> str:
    """M6.2 edge case: ask the Next.js LLM route for a shorter version of
    one line when even max-stretch TTS wouldn't fit its segment."""
    resp = requests.post(
        f"{APP_BASE_URL}/api/internal/shorten-text",
        headers={"x-worker-secret": WORKER_INTERNAL_SECRET},
        json={"text": text, "targetLanguage": target_language},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["text"]


def build_dub_track(
    clip: dict,
    segments: list[dict],
    target_language: str,
    work_dir: str,
    allow_voice_cloning: bool = False,
) -> str:
    """Builds (or rebuilds) the cached clip-length dub audio track. Returns
    its local path."""
    clip_duration_s = clip["end_s"] - clip["start_s"]
    segment_paths: list[str] = []
    offsets_s: list[float] = []

    for i, seg in enumerate(segments):
        seg_duration_s = seg["end"] - seg["start"]
        raw_path = os.path.join(work_dir, f"{clip['id']}_seg{i}_raw.wav")

        def synth(text: str, _path=raw_path) -> tuple[str, float]:
            return synthesize_speech(text, _path, target_language)

        def shorten(text: str) -> str:
            return request_shorter_translation(text, target_language)

        fitted = fit_segment_audio(seg["text"], seg_duration_s, synth, shorten)

        if fitted["action"] == "stretch":
            stretched_path = os.path.join(work_dir, f"{clip['id']}_seg{i}.wav")
            result = subprocess.run(
                ff.build_stretch_args(fitted["path"], stretched_path, fitted["speed"]),
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                raise ValidationError(f"Dub audio stretch failed: {result.stderr[-500:]}")
            segment_paths.append(stretched_path)
        else:
            segment_paths.append(fitted["path"])

        offsets_s.append(seg["start"] - clip["start_s"])

    dub_path = os.path.join(work_dir, f"{clip['id']}_dub.wav")
    result = subprocess.run(
        ff.build_dub_assembly_args(clip_duration_s, segment_paths, offsets_s, dub_path),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise ValidationError(f"Dub audio assembly failed: {result.stderr[-500:]}")
    return dub_path


def dub_track_path(clip_id: str, work_dir: str) -> str:
    """Where build_dub_track cached this clip's dub audio — used by
    render.py to find it without regenerating."""
    return os.path.join(work_dir, f"{clip_id}_dub.wav")
