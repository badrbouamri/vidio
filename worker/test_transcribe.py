import pytest

from transcribe import has_speech, parse_transcription
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
