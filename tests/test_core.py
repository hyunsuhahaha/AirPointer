from airpointer.gesture import recognize
from airpointer.hand_tracker import Point
from airpointer.ui_snap import _distance_to_rect


def _hand() -> list[Point]:
    points = [Point(0.5, 0.8) for _ in range(21)]
    points[0] = Point(0.5, 0.9)
    points[9] = Point(0.5, 0.6)
    for tip, pip in ((8, 6), (12, 10), (16, 14), (20, 18)):
        points[pip] = Point(0.5, 0.5)
        points[tip] = Point(0.5, 0.7)
    return points


def test_index_only_points() -> None:
    points = _hand()
    points[8] = Point(0.5, 0.3)
    points[4] = Point(0.2, 0.5)
    gesture = recognize(points, 0.34)
    assert gesture.pointing and not gesture.pinching and not gesture.paused


def test_pinch_is_normalized_to_palm() -> None:
    points = _hand()
    points[8] = Point(0.5, 0.3)
    points[4] = Point(0.51, 0.31)
    gesture = recognize(points, 0.34)
    assert gesture.pinching and gesture.pointing


def test_distance_to_rect() -> None:
    assert _distance_to_rect(15, 15, (10, 10, 20, 20)) == 0
    assert _distance_to_rect(30, 15, (10, 10, 20, 20)) == 10

