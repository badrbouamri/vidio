import pytest

from usage import estimate_compute_cost, estimate_stt_cost, estimate_tts_cost


def test_estimate_stt_cost_scales_with_duration():
    assert estimate_stt_cost(60) == pytest.approx(0.006)
    assert estimate_stt_cost(600) == pytest.approx(0.06)


def test_estimate_stt_cost_zero_duration():
    assert estimate_stt_cost(0) == 0


def test_estimate_tts_cost_scales_with_char_count():
    assert estimate_tts_cost(1000) == pytest.approx(0.015)
    assert estimate_tts_cost(2000) == pytest.approx(0.03)


def test_estimate_compute_cost_scales_with_wall_clock_time():
    assert estimate_compute_cost(60) == pytest.approx(0.01)
    assert estimate_compute_cost(600) == pytest.approx(0.1)
