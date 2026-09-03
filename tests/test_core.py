from airpointer.gesture import classify_pose
from airpointer.hand_tracker import Point, _select_right_hand


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


def test_tracker_selects_right_hand_and_never_falls_back_to_left() -> None:
    left = [Point(0.2, 0.5) for _ in range(21)]
    right = [Point(0.7, 0.5) for _ in range(21)]
    assert _select_right_hand([("Left", left), ("Right", right)]) is right
    assert _select_right_hand([("Left", left)]) is left


def test_native_pose_classifier_matches_the_browser_contract() -> None:
    assert classify_pose(_hand()) == "palm"
    fist = _hand()
    for tip, pip in ((8, 6), (12, 10), (16, 14), (20, 18)):
        fist[tip] = fist[pip]
    assert classify_pose(fist) == "fist"
