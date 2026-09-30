"""
M4.1/M4.2/M4.3: builds the ffmpeg filter_complex + encode args for a single
render pass — cut, reframe, subtitle burn-in, and loudness normalization all
happen in one ffmpeg invocation (FR-17: "no re-encoding generational loss
beyond one pass").

Pure string-building, no subprocess calls — see render.py for execution.
"""

TARGET_ASPECT = 9 / 16
LOUDNORM_FILTER = "loudnorm=I=-14:TP=-1.5:LRA=11"  # FR-19: ~-14 LUFS


def escape_ffmpeg_path(path: str) -> str:
    """Escapes a filesystem path for embedding as a filter option value
    (e.g. `ass=<path>`) — colons and backslashes are filtergraph
    metacharacters on top of normal shell quoting."""
    escaped = path.replace("\\", "\\\\").replace(":", "\\:")
    return f"'{escaped}'"


def escape_filter_option(value: str) -> str:
    """Escapes a filter *option value* that itself contains filtergraph
    metacharacters (commas, colons) — e.g. a `crop` filter's `x` expression
    built from `if(lt(t,1.00),...)`, where each comma would otherwise be
    parsed as the next chained filter."""
    return value.replace(":", "\\:").replace(",", "\\,")


def build_crop_x_expr(timeline: list[tuple[float, float]]) -> str:
    """Piecewise-linear ffmpeg time expression through `timeline` points
    (FR-18: smoothed camera motion) for use as a `crop` filter's `x` param."""
    if not timeline:
        raise ValueError("empty crop timeline")
    if len(timeline) == 1:
        return f"{timeline[0][1]:.1f}"

    expr = f"{timeline[-1][1]:.1f}"
    pairs = list(zip(timeline, timeline[1:]))
    for (t0, x0), (t1, x1) in reversed(pairs):
        if t1 == t0:
            continue
        slope = (x1 - x0) / (t1 - t0)
        lerp = f"({x0:.1f}+{slope:.4f}*(t-{t0:.2f}))"
        expr = f"if(lt(t,{t1:.2f}),{lerp},{expr})"
    return expr


def build_filter_complex(
    strategy: str,
    source_w: int,
    source_h: int,
    ass_path: str | None = None,
    crop_x_expr: str | None = None,
    audio_source_label: str = "0:a",
) -> tuple[str, str, str]:
    """Returns (filter_complex_string, video_output_label, audio_output_label).
    `audio_source_label` defaults to the main input's audio (`0:a`); pass
    `1:a` when a second `-i` (M6.4's dubbed audio track) has been added to
    the ffmpeg command and should be used instead."""
    parts: list[str] = []

    if strategy == "skip":
        parts.append(
            "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,"
            "crop=1080:1920[v0]"
        )
    elif strategy == "center_crop":
        crop_w = round(source_h * TARGET_ASPECT)
        crop_x = round((source_w - crop_w) / 2)
        parts.append(f"[0:v]crop={crop_w}:{source_h}:{crop_x}:0,scale=1080:1920[v0]")
    elif strategy == "letterbox":
        parts.append("[0:v]split=2[bg][fg]")
        parts.append(
            "[bg]scale=1080:1920:force_original_aspect_ratio=increase,"
            "crop=1080:1920,gblur=sigma=20[bg2]"
        )
        parts.append("[fg]scale=1080:-2:force_original_aspect_ratio=decrease[fg2]")
        parts.append("[bg2][fg2]overlay=(W-w)/2:(H-h)/2[v0]")
    elif strategy == "face_track":
        if not crop_x_expr:
            raise ValueError("face_track strategy requires crop_x_expr")
        crop_w = round(source_h * TARGET_ASPECT)
        escaped_expr = escape_filter_option(crop_x_expr)
        parts.append(f"[0:v]crop={crop_w}:{source_h}:{escaped_expr}:0,scale=1080:1920[v0]")
    else:
        raise ValueError(f"unknown reframe strategy: {strategy}")

    video_label = "v0"
    if ass_path:
        parts.append(f"[v0]ass={escape_ffmpeg_path(ass_path)}[v1]")
        video_label = "v1"

    parts.append(f"[{audio_source_label}]{LOUDNORM_FILTER}[a0]")

    return ";".join(parts), video_label, "a0"


def build_render_args(
    input_path: str,
    output_path: str,
    start_s: float,
    end_s: float,
    filter_complex: str,
    video_label: str,
    audio_label: str,
    audio_input_path: str | None = None,
) -> list[str]:
    """FR-17/FR-19: single cut + encode pass. H.264 MP4, 1080x1920, 30fps, AAC.
    `audio_input_path` (M6.4) adds a second `-i` — an already clip-length
    dub track, so it needs no `-ss`/`-to` of its own — for
    `build_filter_complex`'s `audio_source_label="1:a"` to reference."""
    args = [
        "ffmpeg",
        "-y",
        "-ss", f"{start_s:.3f}",
        "-to", f"{end_s:.3f}",
        "-i", input_path,
    ]
    if audio_input_path:
        args += ["-i", audio_input_path]
    args += [
        "-filter_complex", filter_complex,
        "-map", f"[{video_label}]",
        "-map", f"[{audio_label}]",
        "-r", "30",
        "-c:v", "libx264",
        "-profile:v", "high",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "128k",
        output_path,
    ]
    return args


def build_thumbnail_args(input_path: str, output_path: str, at_s: float) -> list[str]:
    """FR-20: one thumbnail per clip."""
    return [
        "ffmpeg",
        "-y",
        "-ss", f"{at_s:.3f}",
        "-i", input_path,
        "-frames:v", "1",
        output_path,
    ]


def build_stretch_args(input_path: str, output_path: str, tempo: float) -> list[str]:
    """M6.2: time-stretch TTS audio to fit its segment (edge case §11 — up
    to 1.25x). `tempo` > 1 speeds up/shortens; verified empirically that
    ffmpeg's `rubberband` divides duration by `tempo` (not multiplies)."""
    return [
        "ffmpeg", "-y",
        "-i", input_path,
        "-af", f"rubberband=tempo={tempo:.6f}",
        output_path,
    ]


def build_dub_mix_filter(placements: list[tuple[int, float]]) -> str:
    """M6.2/M6.3: places each (already-fitted) segment audio file at its
    clip-relative offset over a silent base track, then mixes down to one
    track. `placements` is [(ffmpeg input index, offset_s), ...] — input 0
    is reserved for the silent base (see build_dub_assembly_args)."""
    parts = ["[0:a]anull[base]"]
    labels = []
    for i, (input_idx, offset_s) in enumerate(placements):
        delay_ms = round(offset_s * 1000)
        label = f"d{i}"
        parts.append(f"[{input_idx}:a]adelay={delay_ms}[{label}]")
        labels.append(label)
    mix_inputs = "[base]" + "".join(f"[{label}]" for label in labels)
    parts.append(
        f"{mix_inputs}amix=inputs={len(labels) + 1}:duration=first:dropout_transition=0[out]"
    )
    return ";".join(parts)


def build_dub_assembly_args(
    clip_duration_s: float,
    segment_paths: list[str],
    offsets_s: list[float],
    output_path: str,
) -> list[str]:
    """Assembles per-segment dub audio into one clip-length track."""
    args = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"anullsrc=r=48000:cl=mono:d={clip_duration_s:.3f}",
    ]
    for path in segment_paths:
        args += ["-i", path]
    placements = [(i + 1, offset) for i, offset in enumerate(offsets_s)]
    args += [
        "-filter_complex", build_dub_mix_filter(placements),
        "-map", "[out]",
        output_path,
    ]
    return args
