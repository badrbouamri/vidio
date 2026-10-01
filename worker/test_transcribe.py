import os
import subprocess

import pytest

from transcribe import _extract_audio, has_speech, parse_transcription
from validation import ValidationError


def make_segment(start, end, text, avg_logprob=-0.2, no_speech_prob=0.05):
    return {
        "start": start,
        "end": end,
        "text": text,
        "avg_logprob": avg_logprob,
        "no_speech_prob": no_speech_prob,
    }


def test_parse_transcription_extracts_words_and_segments():
    raw = {
        "language": "english",
        "words": [
            {"word": "Hello", "start": 0.0, "end": 0.4},
            {"word": "world", "start": 0.4, "end": 0.9},
        ],
        "segments": [make_segment(0.0, 0.9, "Hello world")],
    }
    result = parse_transcription(raw)
    assert result["language"] == "english"
    assert result["words"] == [
        {"word": "Hello", "start": 0.0, "end": 0.4},
        {"word": "world", "start": 0.4, "end": 0.9},
    ]
    assert result["segments"] == [
        {"start": 0.0, "end": 0.9, "text": "Hello world", "lowConfidence": False}
    ]


def test_parse_transcription_flags_low_confidence_segment():
    raw = {
        "language": "english",
        "words": [],
        "segments": [make_segment(0.0, 1.0, "???", avg_logprob=-1.5)],
    }
    result = parse_transcription(raw)
    assert result["segments"][0]["lowConfidence"] is True


def test_parse_transcription_raises_on_no_speech():
    raw = {
        "language": "english",
        "words": [],
        "segments": [
            make_segment(0.0, 5.0, "", no_speech_prob=0.95),
            make_segment(5.0, 10.0, "", no_speech_prob=0.9),
        ],
    }
    with pytest.raises(ValidationError, match="No speech detected"):
        parse_transcription(raw)


def test_parse_transcription_raises_on_zero_segments():
    with pytest.raises(ValidationError, match="No speech detected"):
        parse_transcription({"language": "english", "words": [], "segments": []})


def test_has_speech_true_when_any_segment_has_speech():
    segments = [
        make_segment(0.0, 5.0, "", no_speech_prob=0.95),
        make_segment(5.0, 10.0, "hello", no_speech_prob=0.1),
    ]
    assert has_speech(segments) is True


def test_has_speech_false_for_empty_segments():
    assert has_speech([]) is False


class TestExtractAudio:
    """Regression: both STT providers reject files by filename extension,
    not content. ingest.py stores uploaded sources as a bare `source` file
    with NO extension at all, which Groq flat-out rejected with
    unsupported_audio_format — every upload-sourced transcription failed
    until this fix. See docs/DECISIONS.md."""

    def test_extracts_a_real_wav_regardless_of_source_extension(self, tmp_path):
        source_path = tmp_path / "source"  # no extension — exactly ingest.py's layout
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-f", "lavfi", "-i", "testsrc=duration=1:size=64x64:rate=5",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
                "-c:v", "libx264", "-c:a", "aac", "-shortest", "-f", "mp4", str(source_path),
            ],
            check=True,
            capture_output=True,
        )

        audio_path = _extract_audio(str(source_path))

        assert audio_path == str(tmp_path / "audio.wav")
        assert os.path.getsize(audio_path) > 0

    def test_raises_validation_error_when_ffmpeg_fails(self, tmp_path):
        bogus = tmp_path / "source"
        bogus.write_bytes(b"not a real media file")

        with pytest.raises(ValidationError, match="Audio extraction failed"):
            _extract_audio(str(bogus))
