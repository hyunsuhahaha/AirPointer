from airpointer.face_tracker import WinkDetector


def _prime(detector: WinkDetector) -> None:
    for _ in range(5):
        detector.update(0.30, 0.30)


def test_left_wink_emits_one_left_click_event() -> None:
    detector = WinkDetector()
    _prime(detector)
    assert detector.update(0.10, 0.30).event is None
    state = detector.update(0.10, 0.30)
    assert state.event == "left" and state.left_count == 1
    assert detector.update(0.10, 0.30).event is None


def test_right_wink_emits_right_click_event() -> None:
    detector = WinkDetector()
    _prime(detector)
    detector.update(0.30, 0.10)
    state = detector.update(0.30, 0.10)
    assert state.event == "right" and state.right_count == 1


def test_normal_two_eye_blink_never_clicks() -> None:
    detector = WinkDetector()
    _prime(detector)
    assert detector.update(0.10, 0.10).event is None
    assert detector.update(0.10, 0.10).event is None
    assert detector.update(0.30, 0.30).event is None
