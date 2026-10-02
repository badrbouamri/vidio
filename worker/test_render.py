"""
M6.5: "audio/subtitle toggle produces correct ClipVersion" — verifies
upload_clip_version sends the right `audio` field for each toggle state.
No ffmpeg/network needed (requests.post is mocked), so this always runs
(unlike test_render_integration.py's real-ffmpeg suite).
"""

from unittest.mock import MagicMock, patch

import render


def test_tail_meaningful_ffmpeg_stderr_drops_progress_spam():
    """Regression: a render that crashes mid-encode leaves ffmpeg's repeated
    `\\r`-separated "frame=... speed=..." progress updates as the literal
    tail of stderr, burying the one-time error line that was logged before
    encoding started — reproduced live against a real Railway render
    failure, where the raised error showed only progress noise. See
    docs/DECISIONS.md."""
    stderr = (
        "Unknown encoder 'libx265'\n"
        "Error opening filters!\n"
        "frame=   1 fps=0.0 q=0.0 size=0KiB time=N/A bitrate=N/A\r"
        "frame=   2 fps=0.5 q=0.0 size=0KiB time=N/A bitrate=N/A\r"
        "frame=   3 fps=1.0 q=0.0 size=0KiB time=N/A bitrate=N/A"
    )

    result = render._tail_meaningful_ffmpeg_stderr(stderr)

    assert "Error opening filters!" in result
    assert "frame=" not in result


def _fake_outputs(tmp_path):
    paths = {}
    for key, name in [
        ("video_path", "clip.mp4"),
        ("thumbnail_path", "thumb.jpg"),
        ("srt_path", "clip.srt"),
        ("vtt_path", "clip.vtt"),
    ]:
        path = tmp_path / name
        path.write_bytes(b"x")
        paths[key] = str(path)
    return paths


@patch("render.requests.post")
def test_upload_clip_version_sends_original_audio_by_default(mock_post, tmp_path):
    mock_post.return_value = MagicMock(status_code=200)
    render.upload_clip_version(
        "clip-1", 0.0, 3.0, "classic", "en", _fake_outputs(tmp_path)
    )
    _, kwargs = mock_post.call_args
    assert kwargs["data"]["audio"] == "original"


@patch("render.requests.post")
def test_upload_clip_version_sends_dubbed_audio_when_requested(mock_post, tmp_path):
    mock_post.return_value = MagicMock(status_code=200)
    render.upload_clip_version(
        "clip-1", 0.0, 3.0, "classic", "en", _fake_outputs(tmp_path), audio_source="dubbed"
    )
    _, kwargs = mock_post.call_args
    assert kwargs["data"]["audio"] == "dubbed"
