from airpointer.camera import _start_gate
from airpointer.gesture import InteractionEngine
from airpointer.hand_tracker import Point
from airpointer.ui_snap import _distance_to_rect, _snap_point


def _hand() -> list[Point]:
    points = [Point(0.5, 0.8) for _ in range(21)]
    points[0] = Point(0.5, 0.9)
    points[9] = Point(0.5, 0.6)
    points[5], points[13], points[17] = Point(0.42, 0.65), Point(0.58, 0.65), Point(0.64, 0.70)
    for tip, pip in ((8, 6), (12, 10), (16, 14), (20, 18)):
        points[pip] = Point(0.5, 0.5)
        points[tip] = Point(0.5, 0.3)
    points[4] = Point(0.2, 0.5)
    return points


def test_hand_must_start_on_right_but_can_cross_left_after_tracking() -> None:
    left = [Point(0.2, 0.5) for _ in range(21)]
    right = [Point(0.7, 0.5) for _ in range(21)]
    points, admitted = _start_gate(left, False)
    assert points is None and not admitted
    points, admitted = _start_gate(right, admitted)
    assert points is right and admitted
    points, admitted = _start_gate(left, admitted)
    assert points is left and admitted


def test_open_hand_tracks() -> None:
    points = _hand()
    intent = InteractionEngine().update(points, 0.0)
    assert intent.phase == "tracking" and intent.point is not None
    assert intent.point.y < points[8].y
    assert intent.palm is not None


def test_pointer_projects_index_finger_direction() -> None:
    points = _hand()
    points[5] = Point(0.65, 0.70)
    points[6] = Point(0.60, 0.65)
    points[7] = Point(0.55, 0.58)
    points[8] = Point(0.50, 0.50)
    intent = InteractionEngine().update(points, 0.0)
    assert intent.point is not None
    assert intent.point.x < 0.25
    assert intent.point.y < 0.15


def test_front_facing_index_is_not_mistaken_for_a_fist() -> None:
    points = _hand()
    points[5] = Point(0.50, 0.60, 0.0)
    points[6] = Point(0.50, 0.50, -0.2)
    points[8] = Point(0.50, 0.51, -0.5)
    for tip, pip in ((12, 10), (16, 14), (20, 18)):
        points[tip] = Point(points[pip].x, points[pip].y + 0.08)
    intent = InteractionEngine().update(points, 0.0)
    assert intent.phase == "tracking"


def test_pinch_uses_hysteresis_and_emits_click_on_release() -> None:
    engine = InteractionEngine()
    points = _hand()
    engine.update(points, 0.0)
    points[4] = Point(0.51, 0.31)
    assert engine.update(points, 0.03).phase == "tracking"
    assert engine.update(points, 0.06).phase == "pinch"
    points[4] = Point(0.62, 0.30)  # Between enter and exit thresholds.
    assert engine.update(points, 0.09).phase == "pinch"
    points[4] = Point(0.2, 0.5)
    assert engine.update(points, 0.12).phase == "pinch"
    released = engine.update(points, 0.15)
    assert released.phase == "tracking" and released.event == "click"


def test_hand_loss_has_grace_then_pauses() -> None:
    engine = InteractionEngine(lost_frames=3)
    engine.update(_hand(), 0.0)
    assert engine.update(None, 0.03).phase == "lost"
    assert engine.update(None, 0.06).phase == "lost"
    assert engine.update(None, 0.09).phase == "paused"


def test_held_pinch_promotes_to_captured_drag() -> None:
    engine = InteractionEngine()
    points = _hand()
    engine.update(points, 0.0)
    points[4] = Point(0.51, 0.31)
    engine.update(points, 0.03)
    engine.update(points, 0.06)
    started = engine.update(points, 0.35)
    assert started.phase == "drag" and started.event == "drag_start"
    points[4] = Point(0.2, 0.5)
    engine.update(points, 0.38)
    ended = engine.update(points, 0.41)
    assert ended.phase == "tracking" and ended.event == "drag_end"


def test_interaction_engine_filters_stationary_landmark_jitter() -> None:
    engine = InteractionEngine()
    outputs: list[float] = []
    for index in range(30):
        points = _hand()
        jitter = 0.006 if index % 2 else -0.006
        point = points[8]
        points[8] = Point(point.x + jitter, point.y)
        intent = engine.update(points, index / 30)
        outputs.append(intent.point.x)
    assert max(outputs[-10:]) - min(outputs[-10:]) < 0.004


def test_distance_to_rect() -> None:
    assert _distance_to_rect(15, 15, (10, 10, 20, 20)) == 0
    assert _distance_to_rect(30, 15, (10, 10, 20, 20)) == 10


def test_snap_uses_nearest_safe_point_instead_of_jumping_to_center() -> None:
    assert _snap_point(20, 50, (10, 10, 110, 90)) == (20, 50)
    assert _snap_point(0, 50, (10, 10, 110, 90)) == (14, 50)
