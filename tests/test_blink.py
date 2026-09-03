import numpy as np

from airpointer.camera import _draw_eye
from airpointer.face_tracker import GazeEstimator, WinkDetector


def _prime(detector: WinkDetector) -> None:
    for timestamp in (0.00, 0.05, 0.10, 0.15, 0.20):
        detector.update(0.30, 0.30, timestamp)


def test_left_wink_emits_one_left_click_event() -> None:
    detector = WinkDetector()
    _prime(detector)
    assert detector.update(0.10, 0.30, 1.00).event is None
    assert detector.update(0.10, 0.30, 1.14).event is None
    state = detector.update(0.10, 0.30, 1.16)
    assert state.event == "left" and state.left_count == 1
    assert detector.update(0.10, 0.30, 1.30).event is None


def test_right_wink_emits_right_click_event() -> None:
    detector = WinkDetector()
    _prime(detector)
    detector.update(0.30, 0.10, 1.00)
    assert detector.update(0.30, 0.10, 1.14).event is None
    state = detector.update(0.30, 0.10, 1.16)
    assert state.event == "right" and state.right_count == 1


def test_small_eye_shallow_wink_uses_adjustable_sensitivity() -> None:
    detector = WinkDetector(closed_ratio=0.75)
    for timestamp in (0.00, 0.05, 0.10, 0.15, 0.20):
        detector.update(0.20, 0.20, timestamp)
    detector.update(0.14, 0.20, 1.00)
    assert detector.update(0.14, 0.20, 1.16).event == "left"


def test_short_wink_never_clicks() -> None:
    detector = WinkDetector(min_hold_seconds=0.15)
    _prime(detector)
    assert detector.update(0.10, 0.30, 1.00).event is None
    assert detector.update(0.10, 0.30, 1.14).event is None
    state = detector.update(0.30, 0.30, 1.145)
    assert state.event is None and state.left_count == 0


def test_normal_two_eye_blink_never_clicks() -> None:
    detector = WinkDetector()
    _prime(detector)
    assert detector.update(0.10, 0.10, 1.00).event is None
    assert detector.update(0.10, 0.10, 1.20).event is None
    assert detector.update(0.30, 0.30, 1.25).event is None


def test_gaze_estimator_maps_eye_motion_and_smooths_it() -> None:
    gaze = GazeEstimator(smoothing=0.5)
    assert gaze.update((0.50, 0.50), (0.50, 0.50)) == (0.5, 0.5)
    moved = gaze.update((0.40, 0.45), (0.40, 0.45))
    assert moved[0] > 0.5 and moved[1] < 0.5
    assert moved[0] < 0.8 and moved[1] > 0.3


def test_detected_eye_points_are_drawn_on_preview() -> None:
    frame = np.zeros((180, 320, 3), dtype=np.uint8)
    points = ((0.40, 0.40), (0.42, 0.38), (0.46, 0.38),
              (0.48, 0.40), (0.46, 0.42), (0.42, 0.42))
    _draw_eye(frame, points, closed=False)
    assert np.count_nonzero(frame) > 0
