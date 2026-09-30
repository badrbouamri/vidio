"""
M3.1/M3.2/M3.3/M3.8: speech-to-text with word-level timestamps.

Calls a hosted STT API (per docs/DECISIONS.md — "hosted APIs for v1", not
self-hosted faster-whisper/WhisperX): OpenAI's `/v1/audio/transcriptions`
with `timestamp_granularities=["word"]`, which gives word-level timestamps
plus per-segment `avg_logprob`/`no_speech_prob` we reuse below.

Diarization (FR-10) is NOT implemented — the chosen provider doesn't offer
it, so `speaker` stays unset on every word/segment until a
diarization-capable provider is added (see docs/DECISIONS.md).
"""

import os

import requests

from validation import ValidationError

STT_API_KEY = os.environ.get("STT_API_KEY")
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


def transcribe(path: str, language_override: str | None) -> dict:
    """Returns {"language": str, "words": [...], "segments": [...]}."""
    with open(path, "rb") as f:
        data = {
            "model": STT_MODEL,
            "response_format": "verbose_json",
            "timestamp_granularities[]": "word",
        }
        if language_override:
            data["language"] = language_override
        resp = requests.post(
            STT_API_URL,
            headers={"Authorization": f"Bearer {STT_API_KEY}"},
            files={"file": f},
            data=data,
            timeout=600,
        )
    resp.raise_for_status()
    return parse_transcription(resp.json())


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
