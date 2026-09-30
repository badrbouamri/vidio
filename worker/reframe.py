"""
M4.2: 9:16 reframing decisions (FR-18, edge case §11).

Pure decision logic — separated from face detection (faces.py) and ffmpeg
invocation (render.py) so it's unit-testable with synthetic face-position
data, no video file or model required.
"""

from dataclasses import dataclass

TARGET_ASPECT = 9 / 16  # width/height of the output frame

# Edge case §11 thresholds: how much of the sampled timeline has to look a
# certain way before we commit to a fallback strategy for the whole clip.
NO_FACE_FRACTION_THRESHOLD = 0.7  # share of samples with 0 faces -> "no face found"
MULTI_FACE_FRACTION_THRESHOLD = 0.3  # share of samples with >1 face -> "ambiguous"


@dataclass
class FaceSample:
    t: float
    boxes: list[tuple[float, float, float, float]]  # normalized (x, y, w, h); x/y = top-left


def is_already_vertical(width: int, height: int) -> bool:
    """Edge case §11: skip reframing if the source is already vertical."""
    return width / height <= TARGET_ASPECT + 0.01


def select_strategy(width: int, height: int, samples: list[FaceSample]) -> str:
    """Returns one of "skip" | "letterbox" | "center_crop" | "face_track"
    (FR-18 + edge case §11: multiple speakers/no face -> fallback framing)."""
    if is_already_vertical(width, height):
        return "skip"
    if not samples:
        return "letterbox"

    n = len(samples)
    no_face = sum(1 for s in samples if len(s.boxes) == 0)
    multi_face = sum(1 for s in samples if len(s.boxes) > 1)

    if no_face / n >= NO_FACE_FRACTION_THRESHOLD:
        return "letterbox"
    if multi_face / n >= MULTI_FACE_FRACTION_THRESHOLD:
        return "center_crop"
    return "face_track"


def primary_face_center_x(
    boxes: list[tuple[float, float, float, float]],
) -> float | None:
    """Picks the largest face box (by area) as the active speaker and
    returns its normalized center x. None if there are no boxes."""
    if not boxes:
        return None
    largest = max(boxes, key=lambda b: b[2] * b[3])
    x, _y, w, _h = largest
    return x + w / 2


def smooth_crop_centers(
    samples: list[FaceSample],
    smoothing: float = 0.2,
) -> list[tuple[float, float]]:
    """FR-18 "smoothed camera motion (no jitter)": an exponential moving
    average over the primary face's normalized center x per sample,
    forward-filling samples with no detected face. Returns [(t, center_x)]
    in normalized [0, 1] coordinates."""
    result: list[tuple[float, float]] = []
    ema: float | None = None
    for sample in samples:
        center = primary_face_center_x(sample.boxes)
        if center is None:
            center = ema if ema is not None else 0.5
        ema = center if ema is None else smoothing * center + (1 - smoothing) * ema
        result.append((sample.t, ema))
    return result


def crop_x_timeline(
    samples: list[FaceSample],
    source_w: int,
    source_h: int,
    smoothing: float = 0.2,
) -> list[tuple[float, float]]:
    """Converts smoothed normalized face centers into absolute, clamped crop
    x-offsets (pixels) for a `crop_w x source_h` vertical strip, where
    `crop_w = source_h * 9/16`."""
    crop_w = source_h * TARGET_ASPECT
    centers = smooth_crop_centers(samples, smoothing)
    timeline = []
    for t, center_x_norm in centers:
        center_px = center_x_norm * source_w
        crop_x = center_px - crop_w / 2
        crop_x = max(0.0, min(crop_x, source_w - crop_w))
        timeline.append((t, crop_x))
    return timeline
