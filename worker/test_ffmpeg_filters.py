import pytest

from ffmpeg_filters import (
    build_crop_x_expr,
    build_filter_complex,
    build_render_args,
    build_thumbnail_args,
    escape_ffmpeg_path,
    escape_filter_option,
)


def test_build_crop_x_expr_single_point():
    assert build_crop_x_expr([(0.0, 42.0)]) == "42.0"


def test_build_crop_x_expr_interpolates_between_two_points():
    expr = build_crop_x_expr([(0.0, 0.0), (2.0, 100.0)])
    assert "if(lt(t,2.00)" in expr
    assert "50.0000*(t-0.00)" in expr  # slope = (100-0)/(2-0) = 50


def test_build_crop_x_expr_raises_on_empty():
    with pytest.raises(ValueError):
        build_crop_x_expr([])


def test_escape_filter_option_escapes_commas_and_colons():
    assert escape_filter_option("if(lt(t,1),2,3)") == "if(lt(t\\,1)\\,2\\,3)"
    assert escape_filter_option("a:b,c") == "a\\:b\\,c"


def test_escape_ffmpeg_path_wraps_and_escapes():
    escaped = escape_ffmpeg_path(r"C:\subs\style.ass")
    assert escaped.startswith("'") and escaped.endswith("'")
    assert "\\:" in escaped
    assert "\\\\" in escaped


class TestBuildFilterComplex:
    def test_skip_strategy(self):
        fc, vlabel, alabel = build_filter_complex("skip", 1280, 720)
        assert "[0:v]scale=1080:1920" in fc
        assert vlabel == "v0"
        assert alabel == "a0"
        assert "loudnorm" in fc

    def test_center_crop_strategy_computes_centered_crop(self):
        fc, _, _ = build_filter_complex("center_crop", 1280, 720)
        # crop_w = 720 * 9/16 = 405; crop_x = (1280-405)/2 = 437.5 -> 438 (round)
        assert "crop=405:720:438:0" in fc

    def test_letterbox_strategy_splits_and_overlays(self):
        fc, vlabel, _ = build_filter_complex("letterbox", 1280, 720)
        assert "split=2" in fc
        assert "gblur" in fc
        assert "overlay" in fc
        assert vlabel == "v0"

    def test_face_track_requires_crop_expr(self):
        with pytest.raises(ValueError):
            build_filter_complex("face_track", 1280, 720)

    def test_face_track_embeds_escaped_expr(self):
        expr = build_crop_x_expr([(0.0, 0.0), (1.0, 100.0)])
        fc, _, _ = build_filter_complex("face_track", 1280, 720, crop_x_expr=expr)
        assert "crop=405:720:" in fc
        assert "\\," in fc  # commas from the expr were escaped

    def test_unknown_strategy_raises(self):
        with pytest.raises(ValueError):
            build_filter_complex("teleport", 1280, 720)

    def test_ass_path_appends_subtitle_burn_stage(self):
        fc, vlabel, _ = build_filter_complex("skip", 1280, 720, ass_path="/tmp/x.ass")
        assert "ass=" in fc
        assert vlabel == "v1"


def test_build_render_args_shape():
    fc, vlabel, alabel = build_filter_complex("skip", 1280, 720)
    args = build_render_args("in.mp4", "out.mp4", 1.5, 3.5, fc, vlabel, alabel)
    assert args[0] == "ffmpeg"
    assert "-ss" in args and "1.500" in args
    assert "-to" in args and "3.500" in args
    assert "-map" in args and "[v0]" in args and "[a0]" in args
    assert args[-1] == "out.mp4"


def test_build_thumbnail_args_shape():
    args = build_thumbnail_args("in.mp4", "thumb.jpg", 5.0)
    assert args[0] == "ffmpeg"
    assert "-frames:v" in args
    assert args[-1] == "thumb.jpg"
