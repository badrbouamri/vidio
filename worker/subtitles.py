"""
M4.5/M4.6/M4.7: burned-in word-by-word karaoke subtitles (FR-21), style
presets (FR-22), RTL support (FR-23), SRT/VTT export (FR-24).

Burn-in uses ASS (Advanced SubStation Alpha) + libass, rendered by ffmpeg's
`ass` filter (render.py) — libass + libfribidi + libharfbuzz (all present in
the worker's ffmpeg build, see worker/Dockerfile) handle Arabic/RTL shaping
automatically; this module just has to avoid splitting a word or reordering
text itself.
"""

from dataclasses import dataclass

MAX_CHARS_PER_LINE = 24
MAX_LINES_PER_CARD = 2  # FR-21: max 2 lines on screen at once
MAX_GAP_S = 0.7  # a pause this long starts a new caption card


@dataclass
class Word:
    text: str
    start: float
    end: float


@dataclass
class Card:
    lines: list[list[Word]]  # each line is a list of Words, <= MAX_LINES_PER_CARD lines
    start: float
    end: float

    @property
    def words(self) -> list[Word]:
        return [w for line in self.lines for w in line]


def _line_char_count(line: list[Word]) -> int:
    return sum(len(w.text) for w in line) + max(0, len(line) - 1)  # + spaces


def group_words_into_cards(
    words: list[Word],
    max_chars_per_line: int = MAX_CHARS_PER_LINE,
    max_lines: int = MAX_LINES_PER_CARD,
    max_gap_s: float = MAX_GAP_S,
) -> list[Card]:
    """FR-21: packs words into caption "cards" of at most `max_lines` lines,
    each line capped at `max_chars_per_line` characters, breaking early on a
    speech gap longer than `max_gap_s` so captions stay in sync with pauses."""
    if not words:
        return []

    cards: list[Card] = []
    lines: list[list[Word]] = [[]]

    def flush_card():
        nonlocal lines
        non_empty = [line for line in lines if line]
        if non_empty:
            all_words = [w for line in non_empty for w in line]
            cards.append(
                Card(lines=non_empty, start=all_words[0].start, end=all_words[-1].end)
            )
        lines = [[]]

    prev_end: float | None = None
    for word in words:
        gap = word.start - prev_end if prev_end is not None else 0.0
        current_line = lines[-1]

        starts_new_card = gap > max_gap_s
        fits_current_line = (
            _line_char_count(current_line + [word]) <= max_chars_per_line
        )

        if starts_new_card:
            flush_card()
            lines = [[word]]
        elif fits_current_line:
            current_line.append(word)
        elif len(lines) < max_lines:
            lines.append([word])
        else:
            flush_card()
            lines = [[word]]

        prev_end = word.end

    flush_card()
    return cards


@dataclass
class SubtitleStyle:
    name: str
    font: str
    font_size: int
    primary_color: str  # "#RRGGBB" — already-spoken word color
    secondary_color: str  # "#RRGGBB" — not-yet-spoken word color
    outline_color: str
    back_color: str
    outline: int
    uppercase: bool
    emoji: bool  # reserved for a future decorative-emoji pass — no effect yet


# FR-22: at least 4 style presets (font/size/color/outline/highlight/uppercase/emoji).
STYLE_PRESETS: dict[str, SubtitleStyle] = {
    "classic": SubtitleStyle(
        name="classic",
        font="Arial",
        font_size=64,
        primary_color="#FFFFFF",
        secondary_color="#FFD400",
        outline_color="#000000",
        back_color="#000000",
        outline=3,
        uppercase=False,
        emoji=False,
    ),
    "bold-yellow": SubtitleStyle(
        name="bold-yellow",
        font="Arial Black",
        font_size=72,
        primary_color="#FFFFFF",
        secondary_color="#FFE600",
        outline_color="#000000",
        back_color="#000000",
        outline=4,
        uppercase=True,
        emoji=False,
    ),
    "neon": SubtitleStyle(
        name="neon",
        font="Arial",
        font_size=68,
        primary_color="#00F0FF",
        secondary_color="#FF2EC4",
        outline_color="#1A0033",
        back_color="#000000",
        outline=3,
        uppercase=False,
        emoji=True,
    ),
    "minimal": SubtitleStyle(
        name="minimal",
        font="Helvetica",
        font_size=56,
        primary_color="#FFFFFF",
        secondary_color="#CCCCCC",
        outline_color="#000000",
        back_color="#000000",
        outline=2,
        uppercase=False,
        emoji=False,
    ),
}


def ass_color(hex_rgb: str) -> str:
    """"#RRGGBB" -> ASS's "&HAABBGGRR" (opaque)."""
    hex_rgb = hex_rgb.lstrip("#")
    r, g, b = hex_rgb[0:2], hex_rgb[2:4], hex_rgb[4:6]
    return f"&H00{b}{g}{r}".upper()


def _seconds_to_ass_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h}:{m:02d}:{s:05.2f}"


# Safe-zone margins (px, at 1080x1920) so captions clear TikTok/Reels/Shorts
# UI chrome (FR-21) — bottom-heavy UI needs a larger bottom margin.
SAFE_MARGIN_L = 60
SAFE_MARGIN_R = 60
SAFE_MARGIN_V = 260


def _ass_header(style: SubtitleStyle, video_w: int, video_h: int) -> str:
    return f"""[Script Info]
ScriptType: v4.00+
PlayResX: {video_w}
PlayResY: {video_h}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{style.font},{style.font_size},{ass_color(style.primary_color)},{ass_color(style.secondary_color)},{ass_color(style.outline_color)},{ass_color(style.back_color)},0,0,0,0,100,100,0,0,1,{style.outline},0,2,{SAFE_MARGIN_L},{SAFE_MARGIN_R},{SAFE_MARGIN_V},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def build_ass(
    cards: list[Card],
    style: SubtitleStyle,
    video_w: int = 1080,
    video_h: int = 1920,
) -> str:
    """FR-21/FR-22/FR-23: word-by-word karaoke subtitles as an ASS file for
    ffmpeg's `ass` filter to burn in."""
    header = _ass_header(style, video_w, video_h)
    events = []
    for card in cards:
        text_parts = []
        for line in card.lines:
            word_parts = []
            for word in line:
                duration_cs = max(1, round((word.end - word.start) * 100))
                text = word.text.upper() if style.uppercase else word.text
                word_parts.append(f"{{\\k{duration_cs}}}{text}")
            text_parts.append(" ".join(word_parts))
        text = "\\N".join(text_parts)
        events.append(
            f"Dialogue: 0,{_seconds_to_ass_time(card.start)},"
            f"{_seconds_to_ass_time(card.end)},Default,,0,0,0,,{text}"
        )

    return header + "\n".join(events) + "\n"


def _wrap_plain_text(text: str, max_chars_per_line: int, max_lines: int) -> str:
    """No per-word timing exists for translated text (FR-25 keeps only
    segment-level timing), so this wraps by character count instead of
    packing words — same MAX_LINES_PER_CARD cap as the karaoke path (FR-21)."""
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if len(candidate) <= max_chars_per_line or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
        if len(lines) == max_lines:
            break
    if current and len(lines) < max_lines:
        lines.append(current)
    return "\\N".join(lines)


def build_ass_plain(
    segments: list[dict],
    style: SubtitleStyle,
    video_w: int = 1080,
    video_h: int = 1920,
    max_chars_per_line: int = MAX_CHARS_PER_LINE,
    max_lines: int = MAX_LINES_PER_CARD,
) -> str:
    """M6.4: static (non-karaoke) captions for translated subtitles —
    `segments` is [{"start", "end", "text"}, ...], already clip-relative."""
    header = _ass_header(style, video_w, video_h)
    events = []
    for seg in segments:
        text = seg["text"].upper() if style.uppercase else seg["text"]
        wrapped = _wrap_plain_text(text, max_chars_per_line, max_lines)
        events.append(
            f"Dialogue: 0,{_seconds_to_ass_time(seg['start'])},"
            f"{_seconds_to_ass_time(seg['end'])},Default,,0,0,0,,{wrapped}"
        )
    return header + "\n".join(events) + "\n"


def _srt_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = round((seconds - int(seconds)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _vtt_time(seconds: float) -> str:
    return _srt_time(seconds).replace(",", ".")


def build_srt(segments: list[dict]) -> str:
    """FR-24: plain (non-karaoke) SRT export."""
    lines = []
    for i, seg in enumerate(segments, start=1):
        lines.append(str(i))
        lines.append(f"{_srt_time(seg['start'])} --> {_srt_time(seg['end'])}")
        lines.append(seg["text"])
        lines.append("")
    return "\n".join(lines)


def build_vtt(segments: list[dict]) -> str:
    """FR-24: plain (non-karaoke) WebVTT export."""
    lines = ["WEBVTT", ""]
    for seg in segments:
        lines.append(f"{_vtt_time(seg['start'])} --> {_vtt_time(seg['end'])}")
        lines.append(seg["text"])
        lines.append("")
    return "\n".join(lines)
