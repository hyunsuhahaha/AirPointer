from __future__ import annotations

import math

from .hand_tracker import Point


def is_fist(points: list[Point]) -> bool:
    fingers = ((5, 6, 8), (9, 10, 12), (13, 14, 16), (17, 18, 20))
    return not any(_is_extended(points[mcp], points[pip], points[tip])
                   for mcp, pip, tip in fingers)


def is_open_palm(points: list[Point]) -> bool:
    fingers = ((5, 6, 8), (9, 10, 12), (13, 14, 16), (17, 18, 20))
    return all(_is_extended(points[mcp], points[pip], points[tip])
               for mcp, pip, tip in fingers)


def classify_pose(points: list[Point]) -> str:
    """The original browser classifier, now used as the native source of truth."""
    if len(points) < 21:
        return "none"
    wrist = points[0]
    tips = (8, 12, 16, 20)
    pips = (6, 10, 14, 18)
    extended = [
        _distance(wrist, points[tip]) > _distance(wrist, points[pip]) * 1.18
        for tip, pip in zip(tips, pips)
    ]
    if all(extended):
        return "palm"
    if extended[0] and not any(extended[1:]):
        return "point"
    if not any(extended):
        return "fist"
    return "other"


def _is_extended(mcp: Point, pip: Point, tip: Point) -> bool:
    first = (pip.x - mcp.x, pip.y - mcp.y, pip.z - mcp.z)
    second = (tip.x - pip.x, tip.y - pip.y, tip.z - pip.z)
    lengths = math.sqrt(sum(value * value for value in first)) * math.sqrt(
        sum(value * value for value in second))
    return lengths > 1e-6 and sum(a * b for a, b in zip(first, second)) / lengths > 0.35


def _distance(a: Point, b: Point) -> float:
    return math.hypot(a.x - b.x, a.y - b.y)
