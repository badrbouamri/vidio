"""
M4.2: face detection for 9:16 reframing (FR-18).

Samples frames from the source video and runs MediaPipe's face detector on
each. Kept separate from reframe.py's pure decision logic so that logic can
be unit tested without a video file or model.
"""

import cv2
import mediapipe as mp

from reframe import FaceSample

SAMPLE_FPS = 2  # sampling density — enough to track head movement without
# re-running detection on every frame.


def sample_face_boxes(
    path: str,
    start_s: float = 0.0,
    end_s: float | None = None,
    sample_fps: float = SAMPLE_FPS,
) -> list[FaceSample]:
    """Returns one FaceSample per sampled frame within [start_s, end_s),
    each with normalized (x, y, w, h) boxes for every face MediaPipe finds
    in that frame. Sample timestamps are relative to `start_s` (t=0 at
    start_s) — see docs/DECISIONS.md: ffmpeg's own filter-graph `t` resets
    the same way after an input `-ss` seek, so this lines up with the crop
    expression render.py builds from these samples."""
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_interval = max(1, round(fps / sample_fps))
    cap.set(cv2.CAP_PROP_POS_MSEC, start_s * 1000)

    samples: list[FaceSample] = []
    detector = mp.solutions.face_detection.FaceDetection(
        model_selection=1, min_detection_confidence=0.5
    )
    try:
        frame_idx = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            pos_s = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
            if end_s is not None and pos_s > end_s:
                break
            if frame_idx % frame_interval == 0:
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                result = detector.process(rgb)
                boxes = []
                if result.detections:
                    for det in result.detections:
                        box = det.location_data.relative_bounding_box
                        boxes.append((box.xmin, box.ymin, box.width, box.height))
                samples.append(FaceSample(t=max(0.0, pos_s - start_s), boxes=boxes))
            frame_idx += 1
    finally:
        cap.release()
        detector.close()

    return samples
