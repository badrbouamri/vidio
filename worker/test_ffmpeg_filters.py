import pytest

from ffmpeg_filters import (
    build_crop_x_expr,
    build_dub_assembly_args,
    build_dub_mix_filter,
    build_filter_complex,
    build_render_args,
    build_stretch_args,
    build_thumbnail_args,
    build_watermark_filter,
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

    def test_output_resolution_is_parametrized(self):
        # M7.5: 720p cap for the free tier.
        fc, _, _ = build_filter_complex("skip", 1280, 720, output_w=720, output_h=1280)
        assert "scale=720:1280" in fc
        assert "scale=1080:1920" not in fc

    def test_watermark_off_by_default(self):
        fc, vlabel, _ = build_filter_complex("skip", 1280, 720)
        assert "drawtext" not in fc
        assert vlabel == "v0"

    def test_watermark_appends_drawtext_stage(self):
        fc, vlabel, _ = build_filter_complex("skip", 1280, 720, watermark=True)
        assert "drawtext" in fc
        assert vlabel == "v2"

    def test_watermark_after_subtitles_in_the_chain(self):
        fc, vlabel, _ = build_filter_complex(
            "skip", 1280, 720, ass_path="/tmp/x.ass", watermark=True
        )
        assert "[v0]ass=" in fc
        assert "[v1]drawtext" in fc
        assert vlabel == "v2"


def test_build_render_args_shape():
    fc, vlabel, alabel = build_filter_complex("skip", 1280, 720)
    args = build_render_args("in.mp4", "out.mp4", 1.5, 3.5, fc, vlabel, alabel)
    assert args[0] == "ffmpeg"
    assert "-ss" in args and "1.500" in args
    assert "-to" in args and "3.500" in args
    assert "-map" in args and "[v0]" in args and "[a0]" in args
    assert args[-1] == "out.mp4"


def test_build_render_args_with_dub_audio_input():
    # M6.4: dubbed audio -> a second -i with no -ss/-to of its own, and the
    # filter_complex references it as [1:a] instead of [0:a].
    fc, vlabel, alabel = build_filter_complex("skip", 1280, 720, audio_source_label="1:a")
    assert "[1:a]loudnorm" in fc
    args = build_render_args(
        "in.mp4", "out.mp4", 1.5, 3.5, fc, vlabel, alabel, audio_input_path="dub.wav"
    )
    assert args.count("-i") == 2
    assert "dub.wav" in args
    # the dub input has no -ss/-to of its own — only one -ss/-to pair total,
    # and it's immediately followed by "in.mp4", not "dub.wav".
    assert args.count("-ss") == 1
    assert args[args.index("-i") + 1] != "dub.wav"
    dub_i_idx = args.index("dub.wav") - 1
    assert args[dub_i_idx] == "-i"
    assert args[dub_i_idx - 1] != "-to"


def test_build_thumbnail_args_shape():
    args = build_thumbnail_args("in.mp4", "thumb.jpg", 5.0)
    assert args[0] == "ffmpeg"
    assert "-frames:v" in args
    assert args[-1] == "thumb.jpg"


def test_build_stretch_args_shape():
    args = build_stretch_args("in.wav", "out.wav", 1.25)
    assert args[0] == "ffmpeg"
    assert "-af" in args
    assert "rubberband=tempo=1.250000" in args
    assert args[-1] == "out.wav"


def test_build_dub_mix_filter_places_each_segment_and_mixes():
    filter_str = build_dub_mix_filter([(1, 0.5), (2, 2.5)])
    assert "[0:a]anull[base]" in filter_str
    assert "[1:a]adelay=500[d0]" in filter_str
    assert "[2:a]adelay=2500[d1]" in filter_str
    assert "[base][d0][d1]amix=inputs=3" in filter_str


def test_build_dub_mix_filter_with_no_segments_just_passes_base():
    filter_str = build_dub_mix_filter([])
    assert "[base]amix=inputs=1" in filter_str


def test_build_dub_assembly_args_shape():
    args = build_dub_assembly_args(4.0, ["seg0.wav", "seg1.wav"], [0.5, 2.5], "out.wav")
    assert args[0] == "ffmpeg"
    assert "anullsrc=r=48000:cl=mono:d=4.000" in " ".join(args)
    assert "seg0.wav" in args
    assert "seg1.wav" in args
    assert args[-1] == "out.wav"


def test_build_watermark_filter_scales_fontsize_with_output_width():
    filt_720 = build_watermark_filter(720)
    filt_1080 = build_watermark_filter(1080)
    assert "drawtext" in filt_720
    assert "Nabd" in filt_720
    assert "fontsize=25" in filt_720  # round(720*0.035)
    assert "fontsize=38" in filt_1080  # round(1080*0.035)


def test_build_watermark_filter_positions_bottom_right():
    filt = build_watermark_filter(1080)
    assert "x=w-tw-20" in filt
    assert "y=h-th-20" in filt
