from dataclasses import dataclass
from math import hypot

from .hand_tracker import Point


@dataclass(frozen=True, slots=True)
class Gesture:
    pointing: bool
    pinching: bool
    paused: bool
    index_tip: Point


def recognize(points: list[Point], pinch_threshold: float) -> Gesture:
    index = points[8]
    thumb = points[4]
    palm_size = max(_distance(points[0], points[9]), 0.001)
    pinching = _distance(index, thumb) / palm_size < pinch_threshold

    extended = [points[tip].y < points[pip].y for tip, pip in ((8, 6), (12, 10), (16, 14), (20, 18))]
    fist = not any(extended)
    index_only = extended[0] and not any(extended[1:])
    return Gesture(index_only or pinching, pinching, fist, index)


def _distance(a: Point, b: Point) -> float:
    return hypot(a.x - b.x, a.y - b.y)

