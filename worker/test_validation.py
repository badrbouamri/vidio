import pytest

from validation import ValidationError, parse_ffprobe, validate_probe

GOOD_PROBE = {
    "format": {"duration": "45.2", "format_name": "mov,mp4,m4a,3gp,3g2,mj2"},
    "streams": [
        {"codec_type": "video", "width": 1280, "height": 720},
        {"codec_type": "audio"},
    ],
}


def test_parse_ffprobe_reads_duration_and_stream_kinds():
    info = parse_ffprobe(GOOD_PROBE)
    assert info.duration_s == pytest.approx(45.2)
    assert info.has_video is True
    assert info.has_audio is True
    assert info.width == 1280
    assert info.height == 720


def test_parse_ffprobe_handles_missing_duration():
    info = parse_ffprobe({"format": {}, "streams": []})
    assert info.duration_s == 0.0
    assert info.has_audio is False
    assert info.has_video is False


def test_validate_probe_accepts_good_source():
    validate_probe(parse_ffprobe(GOOD_PROBE))  # should not raise


def test_validate_probe_rejects_no_audio_track():
    probe = {**GOOD_PROBE, "streams": [{"codec_type": "video"}]}
    with pytest.raises(ValidationError, match="No audio track"):
        validate_probe(parse_ffprobe(probe))


def test_validate_probe_rejects_no_video_track():
    probe = {**GOOD_PROBE, "streams": [{"codec_type": "audio"}]}
    with pytest.raises(ValidationError, match="No video track"):
        validate_probe(parse_ffprobe(probe))


def test_validate_probe_rejects_over_duration_cap():
    probe = {**GOOD_PROBE, "format": {**GOOD_PROBE["format"], "duration": "99999"}}
    with pytest.raises(ValidationError, match="longer than the 3h limit"):
        validate_probe(parse_ffprobe(probe))
