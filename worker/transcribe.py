"""
M3.1/M3.2/M3.3/M3.8: speech-to-text with word-level timestamps.

Calls a hosted STT API (per docs/DECISIONS.md — "hosted APIs for v1", not
self-hosted faster-whisper/WhisperX). Groq's Whisper endpoint is primary —
free-tier, OpenAI-API-compatible (`/openai/v1/audio/transcriptions`, same
`timestamp_granularities=["word"]`/`verbose_json` shape as OpenAI's own
API, so `parse_transcription` below is provider-agnostic). OpenAI's own
Whisper API is an optional fallback, used only if STT_API_KEY is set and
Groq raises (quota, outage, or no GROQ_API_KEY configured at all).

Diarization (FR-10) is NOT implemented — neither provider offers it, so
`speaker` stays unset on every word/segment until a diarization-capable
provider is added (see docs/DECISIONS.md).
"""

import os

import requests

from validation import ValidationError

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
GROQ_STT_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
# whisper-large-v3-turbo: same free-tier quota as whisper-large-v3 (20 RPM,
# 2K req/day, 8h audio/day — see docs/DECISIONS.md) but faster; Groq's own
# recommended default for most transcription use cases.
GROQ_STT_MODEL = "whisper-large-v3-turbo"

STT_API_KEY = os.environ.get("STT_API_KEY")  # optional fallback only
STT_API_URL = "https://api.openai.com/v1/audio/transcriptions"
STT_MODEL = "whisper-1"

# FR-9/edge case §11 (mixed-language speech): Whisper has no per-segment
# language-confidence field, so `avg_logprob` (its transcription-confidence
# signal) is used as a proxy for "flag low-confidence segments" — segments
# below this are more likely to contain a language switch or noise the model
# struggled with.
LOW_AVG_LOGPROB_THRESHOLD = -1.0

# M3.8/edge case §11 ("no speech detected"): `no_speech_prob` is Whisper's
# actual silence/no-speech signal — a different concern from the confidence
# proxy above, so it uses its own threshold.
NO_SPEECH_PROB_THRESHOLD = 0.6


def _transcribe_with(
    api_url: str, api_key: str | None, model: str, path: str, language_override: str | None
) -> dict:
    with open(path, "rb") as f:
        data = {
            "model": model,
            "response_format": "verbose_json",
            # Both granularities, not just "word" — Groq's endpoint returns
            # `"segments": null` (no avg_logprob/no_speech_prob, which
            # parse_transcription needs) when only "word" is requested;
            # OpenAI's API returns segments either way, so this is safe for
            # both providers.
            "timestamp_granularities[]": ["word", "segment"],
        }
        if language_override:
            data["language"] = language_override
        resp = requests.post(
            api_url,
            headers={"Authorization": f"Bearer {api_key}"},
            files={"file": f},
            data=data,
            timeout=600,
        )
    resp.raise_for_status()
    return resp.json()


def transcribe(path: str, language_override: str | None) -> dict:
    """Returns {"language": str, "words": [...], "segments": [...]}. Tries
    Groq first; falls back to OpenAI only if STT_API_KEY is set and Groq
    raises (see module docstring)."""
    try:
        raw = _transcribe_with(GROQ_STT_API_URL, GROQ_API_KEY, GROQ_STT_MODEL, path, language_override)
    except Exception:
        if not STT_API_KEY:
            raise
        raw = _transcribe_with(STT_API_URL, STT_API_KEY, STT_MODEL, path, language_override)
    return parse_transcription(raw)


def parse_transcription(raw: dict) -> dict:
    words = [
        {"word": w["word"], "start": w["start"], "end": w["end"]}
        for w in raw.get("words", [])
    ]
    segments = [
        {
            "start": s["start"],
            "end": s["end"],
            "text": s["text"].strip(),
            "lowConfidence": s.get("avg_logprob", 0.0) < LOW_AVG_LOGPROB_THRESHOLD,
        }
        for s in raw.get("segments", [])
    ]

    if not has_speech(raw.get("segments", [])):
        raise ValidationError(
            "No speech detected in this video — try a source with spoken dialogue."
        )

    return {
        "language": raw.get("language", "unknown"),
        "words": words,
        "segments": segments,
    }


def has_speech(segments: list[dict]) -> bool:
    """M3.8 / edge case §11: report clearly when there is no speech at all
    (silence or music-only source), rather than persisting an empty/useless
    transcript. Audio-energy-based highlights (the edge case's other branch)
    are not implemented — this always takes the "stop with a clear message"
    path."""
    if not segments:
        return False
    return any(s.get("no_speech_prob", 0.0) < NO_SPEECH_PROB_THRESHOLD for s in segments)
