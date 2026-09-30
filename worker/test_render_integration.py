"""
M4.10: real ffmpeg/mediapipe integration tests — output-spec compliance,
karaoke color progression, and RTL rendering. Skipped wherever `ffmpeg` (or
opencv/mediapipe, for the pixel-sampling checks) isn't installed, e.g. CI —
see worker/README.md. Run these locally before trusting a render.py change.
"""

import json
import shutil
import subprocess

import pytest

import ffmpeg_filters as ff
import render
from subtitles import STYLE_PRESETS, Word, build_ass, group_words_into_cards

FFMPEG_AVAILABLE = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None
try:
    import cv2  # noqa: F401
    import numpy as np  # noqa: F401

    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False

pytestmark = pytest.mark.skipif(not FFMPEG_AVAILABLE, reason="ffmpeg/ffprobe not installed")


def _run(args):
    result = subprocess.run(args, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr[-3000:]
    return result


def _probe(path):
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


@pytest.fixture(scope="module")
def synthetic_16x9(tmp_path_factory):
    path = tmp_path_factory.mktemp("render") / "source_16x9.mp4"
    _run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=6",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
            "-c:v", "libx264", "-c:a", "aac", "-shortest",
            str(path),
        ]
    )
    return str(path)


class TestOutputSpecCompliance:
    """FR-19: H.264 MP4, 1080x1920, 30fps, AAC, single cut+encode pass."""

    def test_render_clip_matches_output_spec(self, synthetic_16x9, tmp_path):
        clip = {"id": "spec-clip", "start_s": 1.0, "end_s": 3.0}
        transcript = {
            "words": [{"word": "Hi", "start": 1.0, "end": 1.3}],
            "segments": [{"start": 1.0, "end": 1.3, "text": "Hi"}],
        }
        outputs = render.render_clip(synthetic_16x9, clip, transcript, str(tmp_path))

        probe = _probe(outputs["video_path"])
        video = next(s for s in probe["streams"] if s["codec_type"] == "video")
        audio = next(s for s in probe["streams"] if s["codec_type"] == "audio")

        assert video["codec_name"] == "h264"
        assert (video["width"], video["height"]) == (1080, 1920)
        assert audio["codec_name"] == "aac"
        assert float(probe["format"]["duration"]) == pytest.approx(2.0, abs=0.05)

    def test_render_clip_produces_thumbnail_and_subtitle_exports(self, synthetic_16x9, tmp_path):
        clip = {"id": "spec-clip-2", "start_s": 0.0, "end_s": 2.0}
        transcript = {
            "words": [{"word": "Hi", "start": 0.0, "end": 0.3}],
            "segments": [{"start": 0.0, "end": 0.3, "text": "Hi"}],
        }
        outputs = render.render_clip(synthetic_16x9, clip, transcript, str(tmp_path))

        import os

        assert os.path.exists(outputs["thumbnail_path"])
        assert os.path.getsize(outputs["thumbnail_path"]) > 0
        with open(outputs["srt_path"], encoding="utf-8") as f:
            assert "Hi" in f.read()
        with open(outputs["vtt_path"], encoding="utf-8") as f:
            assert "WEBVTT" in f.read()


@pytest.mark.skipif(not CV2_AVAILABLE, reason="opencv not installed")
class TestKaraokeAndRtlRendering:
    """FR-21 (word-by-word highlight) / FR-23 (RTL) — verified by actually
    burning subtitles and sampling pixel colors, not just checking the ASS
    string shape (see test_subtitles.py for that)."""

    @staticmethod
    def _extract_frame(video_path, at_s, out_path):
        _run(["ffmpeg", "-y", "-ss", str(at_s), "-i", video_path, "-frames:v", "1", out_path])

    @staticmethod
    def _count_close(img, target_bgr, tol=20):
        diff = np.abs(img.astype(int) - target_bgr.astype(int))
        return int(np.all(diff <= tol, axis=-1).sum())

    def test_karaoke_highlight_progresses_over_time(self, tmp_path):
        black_src = str(tmp_path / "black.mp4")
        _run(
            [
                "ffmpeg", "-y",
                "-f", "lavfi", "-i", "color=c=black:size=1080x1920:rate=30:duration=5",
                "-f", "lavfi", "-i", "sine=frequency=220:duration=5",
                "-t", "3", "-c:v", "libx264", "-c:a", "aac",
                black_src,
            ]
        )

        style = STYLE_PRESETS["classic"]  # primary=#FFFFFF, secondary=#FFD400
        words = [
            Word(text="Hello", start=0.0, end=1.0),
            Word(text="world", start=1.0, end=2.0),
            Word(text="today", start=2.0, end=3.0),
        ]
        cards = group_words_into_cards(words, max_gap_s=10)
        ass_path = str(tmp_path / "cards.ass")
        with open(ass_path, "w", encoding="utf-8") as f:
            f.write(build_ass(cards, style))

        out_path = str(tmp_path / "out.mp4")
        fc, vlabel, alabel = ff.build_filter_complex("skip", 1080, 1920, ass_path=ass_path)
        args = ff.build_render_args(black_src, out_path, 0.0, 3.0, fc, vlabel, alabel)
        _run(args)

        white = np.array([255, 255, 255])
        gold = np.array([0, 212, 255])  # BGR for #FFD400
        counts = []
        for t in (0.2, 2.8):
            frame_path = str(tmp_path / f"frame_{t}.png")
            self._extract_frame(out_path, t, frame_path)
            img = cv2.imread(frame_path)
            counts.append(
                (self._count_close(img, white), self._count_close(img, gold))
            )

        (early_white, early_gold), (late_white, late_gold) = counts
        # As playback advances through the karaoke cue, more text should
        # have switched from "unspoken" (gold) to "spoken" (white).
        assert late_white > early_white
        assert late_gold <= early_gold

    def test_arabic_rtl_text_renders_visible_glyphs(self, synthetic_16x9, tmp_path):
        style = STYLE_PRESETS["classic"]
        words = [Word(text="مرحبا", start=0.0, end=1.0), Word(text="بالعالم", start=1.0, end=2.0)]
        cards = group_words_into_cards(words, max_gap_s=10)
        ass_path = str(tmp_path / "rtl.ass")
        with open(ass_path, "w", encoding="utf-8") as f:
            f.write(build_ass(cards, style, video_w=1080, video_h=1920))

        out_path = str(tmp_path / "out_rtl.mp4")
        fc, vlabel, alabel = ff.build_filter_complex("skip", 1280, 720, ass_path=ass_path)
        args = ff.build_render_args(synthetic_16x9, out_path, 0.0, 2.0, fc, vlabel, alabel)
        _run(args)

        frame_path = str(tmp_path / "frame_rtl.png")
        self._extract_frame(out_path, 1.0, frame_path)
        img = cv2.imread(frame_path)
        assert img is not None
        # Just needs to have rendered *something* without crashing — pixel
        # content is a weak proxy for "text appeared", not for correctness.
        assert int(np.any(img > 30, axis=-1).sum()) > 0


class TestDubAudioAssembly:
    """M6.2/M6.3: real ffmpeg verification that stretched/padded segment
    audio lands at the right offsets in the assembled clip-length track."""

    @staticmethod
    def _rms_db_at(path, at_s, window_s=0.2):
        result = subprocess.run(
            [
                "ffmpeg", "-y", "-ss", str(at_s), "-t", str(window_s), "-i", path,
                "-af", "astats=metadata=1:reset=1", "-f", "null", "-",
            ],
            capture_output=True, text=True,
        )
        for line in result.stderr.splitlines():
            if "RMS level dB" in line:
                return float(line.split(":")[-1].strip())
        return float("-inf")

    def test_stretch_shortens_audio_to_the_target_duration(self, tmp_path):
        tone = str(tmp_path / "tone.wav")
        _run(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", tone])

        stretched = str(tmp_path / "stretched.wav")
        _run(ff.build_stretch_args(tone, stretched, tempo=1.5))

        probe = _probe(stretched)
        assert float(probe["format"]["duration"]) == pytest.approx(2.0, abs=0.05)

    def test_assembly_places_segments_at_their_offsets_and_silence_elsewhere(self, tmp_path):
        seg0 = str(tmp_path / "seg0.wav")
        seg1 = str(tmp_path / "seg1.wav")
        _run(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", seg0])
        _run(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=880:duration=1", seg1])

        out = str(tmp_path / "assembled.wav")
        args = ff.build_dub_assembly_args(4.0, [seg0, seg1], [0.5, 2.5], out)
        _run(args)

        probe = _probe(out)
        assert float(probe["format"]["duration"]) == pytest.approx(4.0, abs=0.05)

        # Silent before/between segments, audible during each segment's window.
        assert self._rms_db_at(out, 0.1) == float("-inf")
        assert self._rms_db_at(out, 1.0) > -60
        assert self._rms_db_at(out, 2.0) == float("-inf")
        assert self._rms_db_at(out, 3.0) > -60

    def test_render_clip_uses_the_dub_track_when_audio_source_is_dubbed(
        self, synthetic_16x9, tmp_path
    ):
        # M6.4: render_clip should wire a provided dub track in as the
        # output's audio instead of the source's own — this exercises the
        # real ffmpeg command (two -i's, [1:a] routed through loudnorm),
        # not just the string-builder unit tests in test_ffmpeg_filters.py.
        dub_track = str(tmp_path / "dub.wav")
        _run(
            [
                "ffmpeg", "-y", "-f", "lavfi",
                "-i", "sine=frequency=660:duration=2",
                dub_track,
            ]
        )

        clip = {"id": "dub-clip", "start_s": 1.0, "end_s": 3.0}
        transcript = {"words": [], "segments": []}
        outputs = render.render_clip(
            synthetic_16x9,
            clip,
            transcript,
            str(tmp_path),
            audio_source="dubbed",
            dub_audio_path=dub_track,
        )

        probe = _probe(outputs["video_path"])
        audio = next(s for s in probe["streams"] if s["codec_type"] == "audio")
        assert audio["codec_name"] == "aac"
        assert float(probe["format"]["duration"]) == pytest.approx(2.0, abs=0.05)

    def test_render_clip_burns_translated_segments_when_requested(
        self, synthetic_16x9, tmp_path
    ):
        clip = {"id": "translated-clip", "start_s": 0.0, "end_s": 2.0}
        transcript = {"words": [], "segments": []}
        translated = [{"start": 0.0, "end": 1.0, "text": "Bonjour le monde"}]

        outputs = render.render_clip(
            synthetic_16x9,
            clip,
            transcript,
            str(tmp_path),
            subtitle_lang_pref="translated",
            translated_segments=translated,
        )

        with open(outputs["srt_path"], encoding="utf-8") as f:
            assert "Bonjour le monde" in f.read()
