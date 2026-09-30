"""
Server-side source validation (M2.4 / FR-6).

Pure parsing + validation logic, kept separate from the ffprobe subprocess
call itself so it can be unit tested with canned ffprobe output — no ffmpeg
binary or real file required.
"""

from dataclasses import dataclass

MAX_DURATION_S = 3 * 60 * 60  # 3h — mirrors src/lib/video-validation.ts


@dataclass
class ProbeInfo:
    duration_s: float
    has_audio: bool
    has_video: bool


class ValidationError(Exception):
    """Raised with a user-readable reason (FR-6: readable rejection reasons)."""


def parse_ffprobe(raw: dict) -> ProbeInfo:
    streams = raw.get("streams", [])
    duration_raw = raw.get("format", {}).get("duration")
    return ProbeInfo(
        duration_s=float(duration_raw) if duration_raw is not None else 0.0,
        has_audio=any(s.get("codec_type") == "audio" for s in streams),
        has_video=any(s.get("codec_type") == "video" for s in streams),
    )


def validate_probe(info: ProbeInfo, max_duration_s: float = MAX_DURATION_S) -> None:
    """Raises ValidationError with a readable reason, or returns None if OK."""
    if not info.has_video:
        raise ValidationError("No video track found in the source file.")
    if not info.has_audio:
        raise ValidationError(
            "No audio track found in the source file — captions/transcription need audio."
        )
    if info.duration_s > max_duration_s:
        hours = max_duration_s / 3600
        raise ValidationError(f"Video is longer than the {hours:g}h limit.")
