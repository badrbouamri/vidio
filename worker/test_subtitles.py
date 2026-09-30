import pytest

from subtitles import (
    SAFE_MARGIN_L,
    SAFE_MARGIN_R,
    SAFE_MARGIN_V,
    STYLE_PRESETS,
    Card,
    Word,
    ass_color,
    build_ass,
    build_ass_plain,
    build_srt,
    build_vtt,
    group_words_into_cards,
)


def words(*specs):
    return [Word(text=t, start=s, end=e) for t, s, e in specs]


class TestGroupWordsIntoCards:
    def test_empty_input(self):
        assert group_words_into_cards([]) == []

    def test_short_sentence_fits_one_line(self):
        ws = words(("Hi", 0.0, 0.3), ("there", 0.3, 0.6))
        cards = group_words_into_cards(ws)
        assert len(cards) == 1
        assert len(cards[0].lines) == 1
        assert [w.text for w in cards[0].words] == ["Hi", "there"]

    def test_wraps_to_a_second_line_when_over_char_limit(self):
        ws = words(("alpha", 0.0, 0.2), ("bb", 0.2, 0.4), ("cc", 0.4, 0.6))
        cards = group_words_into_cards(ws, max_chars_per_line=6, max_lines=2)
        assert len(cards) == 1
        assert len(cards[0].lines) == 2
        assert [w.text for w in cards[0].lines[0]] == ["alpha"]
        assert [w.text for w in cards[0].lines[1]] == ["bb", "cc"]

    def test_starts_a_new_card_beyond_max_lines(self):
        ws = words(
            ("alpha", 0.0, 0.2),
            ("bravo", 0.2, 0.4),
            ("charl", 0.4, 0.6),
            ("delta", 0.6, 0.8),
        )
        cards = group_words_into_cards(ws, max_chars_per_line=10, max_lines=2)
        assert len(cards) == 2

    def test_breaks_on_a_long_pause(self):
        ws = words(("Hello", 0.0, 0.3), ("world", 5.0, 5.3))
        cards = group_words_into_cards(ws, max_gap_s=0.7)
        assert len(cards) == 2
        assert cards[0].words[0].text == "Hello"
        assert cards[1].words[0].text == "world"

    def test_never_drops_a_word(self):
        ws = words(*[(f"w{i}", i * 0.3, i * 0.3 + 0.2) for i in range(30)])
        cards = group_words_into_cards(ws, max_chars_per_line=8, max_lines=2)
        total = sum(len(c.words) for c in cards)
        assert total == len(ws)


def test_ass_color_conversion():
    assert ass_color("#FFFFFF") == "&H00FFFFFF"
    assert ass_color("#FF0000") == "&H000000FF"  # red -> BGR order
    assert ass_color("#00FF00") == "&H0000FF00"


class TestBuildAss:
    def test_includes_karaoke_tags_per_word(self):
        cards = group_words_into_cards(
            words(("Hello", 1.0, 1.5), ("world", 1.5, 2.1))
        )
        content = build_ass(cards, STYLE_PRESETS["classic"])
        assert "{\\k50}Hello" in content
        assert "{\\k60}world" in content

    def test_uppercase_style_transforms_text(self):
        cards = group_words_into_cards(words(("hello", 0.0, 0.5)))
        content = build_ass(cards, STYLE_PRESETS["bold-yellow"])
        assert "HELLO" in content
        assert "hello" not in content

    def test_two_lines_joined_with_ass_newline(self):
        ws = words(("alpha", 0.0, 0.2), ("bravo", 0.2, 0.4), ("charl", 0.4, 0.6))
        cards = group_words_into_cards(ws, max_chars_per_line=10, max_lines=2)
        content = build_ass(cards, STYLE_PRESETS["classic"])
        assert "\\N" in content

    def test_rtl_text_passed_through_unchanged(self):
        arabic = "مرحبا"
        cards = group_words_into_cards(words((arabic, 0.0, 0.5)))
        content = build_ass(cards, STYLE_PRESETS["classic"])
        assert arabic in content

    def test_includes_playres_and_default_style(self):
        content = build_ass([], STYLE_PRESETS["minimal"], video_w=1080, video_h=1920)
        assert "PlayResX: 1080" in content
        assert "PlayResY: 1920" in content
        assert "Style: Default" in content

    def test_style_line_encodes_safe_zone_margins(self):
        # FR-21: captions positioned in the safe zone (not hidden by
        # TikTok/Reels UI chrome) — margins are the last thing standing
        # between this and unreadable captions in production.
        content = build_ass([], STYLE_PRESETS["classic"])
        style_line = next(line for line in content.splitlines() if line.startswith("Style:"))
        margins = style_line.split(",")[-4:-1]  # MarginL, MarginR, MarginV
        assert margins == [str(SAFE_MARGIN_L), str(SAFE_MARGIN_R), str(SAFE_MARGIN_V)]


class TestBuildAssPlain:
    """M6.4: translated subtitles — segment-level static captions, no
    per-word karaoke tags (there's no per-word timing to hang them on)."""

    def test_no_karaoke_tags(self):
        segments = [{"start": 0.0, "end": 1.5, "text": "Bonjour le monde"}]
        content = build_ass_plain(segments, STYLE_PRESETS["classic"])
        assert "\\k" not in content
        assert "Bonjour le monde" in content

    def test_uppercase_style_applies(self):
        segments = [{"start": 0.0, "end": 1.0, "text": "bonjour"}]
        content = build_ass_plain(segments, STYLE_PRESETS["bold-yellow"])
        assert "BONJOUR" in content

    def test_wraps_long_text_up_to_max_lines(self):
        segments = [{"start": 0.0, "end": 3.0, "text": "one two three four five six"}]
        content = build_ass_plain(segments, STYLE_PRESETS["classic"], max_chars_per_line=10)
        dialogue = next(line for line in content.splitlines() if line.startswith("Dialogue:"))
        assert "\\N" in dialogue
        assert dialogue.count("\\N") <= 1  # MAX_LINES_PER_CARD=2 -> at most one break

    def test_one_dialogue_event_per_segment(self):
        segments = [
            {"start": 0.0, "end": 1.0, "text": "first"},
            {"start": 1.0, "end": 2.0, "text": "second"},
        ]
        content = build_ass_plain(segments, STYLE_PRESETS["classic"])
        dialogue_lines = [l for l in content.splitlines() if l.startswith("Dialogue:")]
        assert len(dialogue_lines) == 2


class TestSrtVtt:
    SEGMENTS = [
        {"start": 0.0, "end": 1.5, "text": "Hello world"},
        {"start": 1.5, "end": 3.25, "text": "Second line"},
    ]

    def test_srt_format(self):
        srt = build_srt(self.SEGMENTS)
        assert "1\n00:00:00,000 --> 00:00:01,500\nHello world" in srt
        assert "2\n00:00:01,500 --> 00:00:03,250\nSecond line" in srt

    def test_vtt_format(self):
        vtt = build_vtt(self.SEGMENTS)
        assert vtt.startswith("WEBVTT\n")
        assert "00:00:00.000 --> 00:00:01.500" in vtt
        assert "00:00:01.500 --> 00:00:03.250" in vtt
