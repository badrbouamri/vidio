import pytest

from reframe import (
    FaceSample,
    crop_x_timeline,
    is_already_vertical,
    primary_face_center_x,
    select_strategy,
    smooth_crop_centers,
)


def test_is_already_vertical():
    assert is_already_vertical(720, 1280) is True
    assert is_already_vertical(1080, 1920) is True
    assert is_already_vertical(1280, 720) is False


def test_select_strategy_skips_vertical_source_regardless_of_faces():
    assert select_strategy(720, 1280, []) == "skip"


def test_select_strategy_letterbox_when_no_samples():
    assert select_strategy(1280, 720, []) == "letterbox"


def test_select_strategy_letterbox_when_no_face_found():
    samples = [FaceSample(t=i, boxes=[]) for i in range(10)]
    assert select_strategy(1280, 720, samples) == "letterbox"


def test_select_strategy_center_crop_when_multiple_speakers():
    samples = [
        FaceSample(t=i, boxes=[(0.1, 0.1, 0.2, 0.2), (0.6, 0.1, 0.2, 0.2)])
        for i in range(10)
    ]
    assert select_strategy(1280, 720, samples) == "center_crop"


def test_select_strategy_face_track_for_a_single_consistent_speaker():
    samples = [FaceSample(t=i, boxes=[(0.4, 0.3, 0.2, 0.2)]) for i in range(10)]
    assert select_strategy(1280, 720, samples) == "face_track"


def test_primary_face_center_x_picks_largest_box():
    boxes = [(0.0, 0.0, 0.1, 0.1), (0.5, 0.5, 0.4, 0.4)]
    assert primary_face_center_x(boxes) == pytest.approx(0.7)


def test_primary_face_center_x_none_when_empty():
    assert primary_face_center_x([]) is None


def test_smooth_crop_centers_eases_toward_a_jump_rather_than_snapping():
    samples = [
        FaceSample(t=0, boxes=[(0.1, 0.0, 0.2, 0.2)]),  # center 0.2
        FaceSample(t=1, boxes=[(0.7, 0.0, 0.2, 0.2)]),  # center 0.8 (sudden jump)
        FaceSample(t=2, boxes=[(0.7, 0.0, 0.2, 0.2)]),
    ]
    centers = [c for _, c in smooth_crop_centers(samples, smoothing=0.2)]
    assert centers[0] == pytest.approx(0.2)
    # after the jump, smoothed value moves toward 0.8 but doesn't reach it in one step
    assert 0.2 < centers[1] < 0.8
    # continues converging
    assert centers[1] < centers[2] < 0.8


def test_smooth_crop_centers_forward_fills_missing_faces():
    samples = [
        FaceSample(t=0, boxes=[(0.4, 0.0, 0.2, 0.2)]),  # center 0.5
        FaceSample(t=1, boxes=[]),  # no face this sample
    ]
    centers = [c for _, c in smooth_crop_centers(samples)]
    assert centers[1] == centers[0]  # holds the last known position


def test_crop_x_timeline_clamps_within_frame_bounds():
    # face pinned at the far left edge — crop must not go negative
    samples = [FaceSample(t=i, boxes=[(0.0, 0.0, 0.05, 0.05)]) for i in range(20)]
    timeline = crop_x_timeline(samples, source_w=1280, source_h=720, smoothing=1.0)
    assert all(x >= 0 for _, x in timeline)

    # face pinned at the far right edge — crop must not exceed source_w - crop_w
    samples = [FaceSample(t=i, boxes=[(0.9, 0.0, 0.05, 0.05)]) for i in range(20)]
    timeline = crop_x_timeline(samples, source_w=1280, source_h=720, smoothing=1.0)
    crop_w = 720 * (9 / 16)
    assert all(x <= 1280 - crop_w + 1e-6 for _, x in timeline)
