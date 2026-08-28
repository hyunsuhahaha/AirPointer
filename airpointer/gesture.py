from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

from .hand_tracker import Point

Phase = Literal["tracking", "pinch", "drag", "lost", "paused"]
Event = Literal["click", "drag_start", "drag_end"]


@dataclass(frozen=True, slots=True)
class Intent:
    phase: Phase
    point: Point | None
    event: Event | None = None
    pinch_ratio: float | None = None
    confidence: float = 1.0
    palm: Point | None = None


class _OneEuro:
    def __init__(self, min_cutoff: float = 1.0, beta: float = 0.04) -> None:
        self.min_cutoff = min_cutoff
        self.beta = beta
        self._time: float | None = None
        self._value: float | None = None
        self._velocity = 0.0

    def reset(self) -> None:
        self._time = self._value = None
        self._velocity = 0.0

    def update(self, value: float, timestamp: float) -> float:
        if self._time is None or self._value is None:
            self._time, self._value = timestamp, value
            return value
        dt = timestamp - self._time
        if dt <= 0:
            return self._value
        velocity = (value - self._value) / dt
        self._velocity = _low_pass(self._velocity, velocity, _alpha(dt, 1.0))
        cutoff = self.min_cutoff + self.beta * abs(self._velocity)
        self._value = _low_pass(self._value, value, _alpha(dt, cutoff))
        self._time = timestamp
        return self._value


class InteractionEngine:
    """Turns hand landmarks into stable interaction intent; performs no I/O."""

    def __init__(self, pinch_on: float = 0.34, pinch_off: float | None = None,
                 confirm_frames: int = 2, lost_frames: int = 5) -> None:
        self.pinch_on = pinch_on
        self.pinch_off = pinch_off or pinch_on * 1.35
        self.confirm_frames = confirm_frames
        self.lost_frames = lost_frames
        self._phase: Phase = "paused"
        self._enter_run = self._exit_run = self._absent_run = 0
        self._pinch_time: float | None = None
        self._pinch_point: Point | None = None
        self._last_point: Point | None = None
        self._last_palm: Point | None = None
        self._x_filter, self._y_filter = _OneEuro(), _OneEuro()
        self._palm_x_filter, self._palm_y_filter = _OneEuro(), _OneEuro()

    def update(self, points: list[Point] | None, timestamp: float) -> Intent:
        if not points:
            return self._missing()

        self._absent_run = 0
        raw_point = points[8]
        raw_palm = _palm_center(points)
        point = Point(self._x_filter.update(raw_point.x, timestamp),
                      self._y_filter.update(raw_point.y, timestamp))
        palm = Point(self._palm_x_filter.update(raw_palm.x, timestamp),
                     self._palm_y_filter.update(raw_palm.y, timestamp))
        self._last_point = point
        self._last_palm = palm
        if _is_fist(points):
            event = "drag_end" if self._phase == "drag" else None
            self._pause()
            return Intent("paused", None, event, confidence=0.0)

        ratio = _distance(points[4], points[8]) / max(_distance(points[0], points[9]), 0.001)
        self._advance_hysteresis(ratio)

        if self._phase in ("paused", "lost"):
            self._phase = "tracking"

        event: Event | None = None
        if self._phase == "tracking" and self._enter_run >= self.confirm_frames:
            self._phase = "pinch"
            self._pinch_time, self._pinch_point = timestamp, palm
            self._exit_run = 0
        elif self._phase == "pinch":
            assert self._pinch_time is not None and self._pinch_point is not None
            moved = _distance(palm, self._pinch_point)
            if self._exit_run >= self.confirm_frames:
                self._phase, event = "tracking", "click"
                self._clear_pinch()
            elif timestamp - self._pinch_time >= 0.25 or moved >= 0.018:
                self._phase, event = "drag", "drag_start"
        elif self._phase == "drag" and self._exit_run >= self.confirm_frames:
            self._phase, event = "tracking", "drag_end"
            self._clear_pinch()

        return Intent(self._phase, point, event, ratio, palm=palm)

    def _missing(self) -> Intent:
        self._absent_run += 1
        if self._absent_run < self.lost_frames and self._last_point is not None:
            confidence = 1.0 - self._absent_run / self.lost_frames
            return Intent("lost", self._last_point, confidence=confidence, palm=self._last_palm)
        event = "drag_end" if self._phase == "drag" else None
        self._pause()
        return Intent("paused", None, event, confidence=0.0)

    def _advance_hysteresis(self, ratio: float) -> None:
        self._enter_run = self._enter_run + 1 if ratio < self.pinch_on else 0
        self._exit_run = self._exit_run + 1 if ratio > self.pinch_off else 0

    def _pause(self) -> None:
        self._phase = "paused"
        self._enter_run = self._exit_run = 0
        self._clear_pinch()
        self._x_filter.reset()
        self._y_filter.reset()
        self._palm_x_filter.reset()
        self._palm_y_filter.reset()

    def _clear_pinch(self) -> None:
        self._pinch_time = None
        self._pinch_point = None


def _palm_center(points: list[Point]) -> Point:
    palm = [points[i] for i in (0, 5, 9, 13, 17)]
    return Point(sum(p.x for p in palm) / len(palm), sum(p.y for p in palm) / len(palm))


def _is_fist(points: list[Point]) -> bool:
    return all(points[tip].y >= points[pip].y for tip, pip in ((8, 6), (12, 10), (16, 14), (20, 18)))


def _distance(a: Point, b: Point) -> float:
    return math.hypot(a.x - b.x, a.y - b.y)


def _alpha(dt: float, cutoff: float) -> float:
    tau = 1.0 / (2.0 * math.pi * cutoff)
    return 1.0 / (1.0 + tau / dt)


def _low_pass(previous: float, value: float, alpha: float) -> float:
    return alpha * value + (1.0 - alpha) * previous
