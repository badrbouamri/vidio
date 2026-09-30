import pytest

from dub import can_use_voice_cloning, fit_segment_audio, plan_dub_timing


class TestPlanDubTiming:
    def test_pads_when_tts_is_shorter_than_the_segment(self):
        assert plan_dub_timing(2.0, 3.0) == {"action": "pad", "speed": 1.0}

    def test_pads_when_tts_exactly_matches(self):
        assert plan_dub_timing(3.0, 3.0) == {"action": "pad", "speed": 1.0}

    def test_stretches_within_the_max_ratio(self):
        result = plan_dub_timing(3.6, 3.0)  # ratio 1.2
        assert result["action"] == "stretch"
        assert result["speed"] == pytest.approx(1.2)

    def test_stretches_at_exactly_the_max_ratio(self):
        result = plan_dub_timing(3.75, 3.0, max_stretch=1.25)  # ratio exactly 1.25
        assert result["action"] == "stretch"

    def test_shortens_beyond_the_max_ratio(self):
        result = plan_dub_timing(4.5, 3.0, max_stretch=1.25)  # ratio 1.5
        assert result == {"action": "shorten", "speed": None}

    def test_rejects_nonpositive_segment_duration(self):
        with pytest.raises(ValueError):
            plan_dub_timing(1.0, 0)


class TestFitSegmentAudio:
    def test_returns_immediately_when_first_take_fits(self):
        calls = []

        def synthesize(text):
            calls.append(text)
            return (f"/tmp/{text}.wav", 2.5)

        def shorten(text):
            raise AssertionError("should not be called")

        result = fit_segment_audio("hello", 3.0, synthesize, shorten)
        assert result["action"] == "pad"
        assert calls == ["hello"]

    def test_stretches_when_slightly_too_long(self):
        def synthesize(text):
            return (f"/tmp/{text}.wav", 3.6)

        def shorten(text):
            raise AssertionError("should not be called")

        result = fit_segment_audio("hello", 3.0, synthesize, shorten)
        assert result["action"] == "stretch"
        assert result["speed"] == pytest.approx(1.2)

    def test_shortens_once_then_fits(self):
        durations = iter([4.5, 2.8])  # first take too long, second fits
        shorten_calls = []

        def synthesize(text):
            return (f"/tmp/{text}.wav", next(durations))

        def shorten(text):
            shorten_calls.append(text)
            return f"{text} (shorter)"

        result = fit_segment_audio("a long line", 3.0, synthesize, shorten, max_shorten_attempts=2)
        assert result["action"] == "pad"
        assert result["text"] == "a long line (shorter)"
        assert shorten_calls == ["a long line"]

    def test_gives_up_after_max_attempts_and_caps_at_max_stretch(self):
        # Every attempt is still too long even after shortening.
        def synthesize(text):
            return (f"/tmp/{text}.wav", 10.0)

        shorten_calls = []

        def shorten(text):
            shorten_calls.append(text)
            return f"{text}!"

        result = fit_segment_audio(
            "stubborn", 3.0, synthesize, shorten, max_stretch=1.25, max_shorten_attempts=2
        )
        assert result["action"] == "stretch"
        assert result["speed"] == 1.25  # best-effort cap, not the real (too-long) ratio
        assert len(shorten_calls) == 2  # exhausted its budget, no more, no infinite loop


class TestCanUseVoiceCloning:
    def test_blocks_by_default(self):
        assert can_use_voice_cloning({}) is False

    def test_blocks_enabled_without_consent(self):
        assert can_use_voice_cloning({"voiceCloningEnabled": True}) is False

    def test_blocks_consent_without_enabling(self):
        assert can_use_voice_cloning({"voiceCloningConsent": True}) is False

    def test_allows_both(self):
        assert (
            can_use_voice_cloning({"voiceCloningEnabled": True, "voiceCloningConsent": True})
            is True
        )
