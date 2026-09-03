from __future__ import annotations

import math
import time
from dataclasses import dataclass, replace
from typing import Literal


@dataclass(frozen=True, slots=True)
class WinkState:
    left_closed: bool = False
    right_closed: bool = False
    event: Literal["left", "right"] | None = None
    left_count: int = 0
    right_count: int = 0
    left_ear: float | None = None
    right_ear: float | None = None
    left_points: tuple[tuple[float, float], ...] = ()
    right_points: tuple[tuple[float, float], ...] = ()
    gaze: tuple[float, float] | None = None


class GazeEstimator:
    def __init__(self, smoothing: float = 0.25) -> None:
        self.smoothing = smoothing
        self._point: tuple[float, float] | None = None

    def update(self, left: tuple[float, float], right: tuple[float, float]) -> tuple[float, float]:
        eye_x = (left[0] + right[0]) / 2
        eye_y = (left[1] + right[1]) / 2
        target = (_clamp(0.5 - (eye_x - 0.5) * 3.0),
                  _clamp(0.5 + (eye_y - 0.5) * 4.0))
        if self._point is None:
            self._point = target
        else:
            amount = self.smoothing
            self._point = (self._point[0] + (target[0] - self._point[0]) * amount,
                           self._point[1] + (target[1] - self._point[1]) * amount)
        return self._point

    def reset(self) -> None:
        self._point = None


class WinkDetector:
    def __init__(self, closed_ratio: float = 0.75, min_hold_seconds: float = 0.15) -> None:
        self.closed_ratio = closed_ratio
        self.min_hold_seconds = min_hold_seconds
        self._left_base: float | None = None
        self._right_base: float | None = None
        self._left_since: float | None = None
        self._right_since: float | None = None
        self._latched = False
        self.left_count = self.right_count = 0

    def update(self, left_ear: float | None, right_ear: float | None,
               timestamp: float | None = None) -> WinkState:
        now = time.monotonic() if timestamp is None else timestamp
        if left_ear is None or right_ear is None:
            self._left_since = self._right_since = None
            self._latched = False
            return WinkState(left_count=self.left_count, right_count=self.right_count)

        self._left_base = self._left_base or left_ear
        self._right_base = self._right_base or right_ear
        left_closed = left_ear < self._left_base * self.closed_ratio
        right_closed = right_ear < self._right_base * self.closed_ratio
        event = None

        if left_closed and not right_closed:
            self._left_since = now if self._left_since is None else self._left_since
            self._right_since = None
            if now - self._left_since >= self.min_hold_seconds and not self._latched:
                event, self._latched = "left", True
                self.left_count += 1
        elif right_closed and not left_closed:
            self._right_since = now if self._right_since is None else self._right_since
            self._left_since = None
            if now - self._right_since >= self.min_hold_seconds and not self._latched:
                event, self._latched = "right", True
                self.right_count += 1
        else:
            self._left_since = self._right_since = None
            if not left_closed and not right_closed:
                self._latched = False

        if not left_closed:
            self._left_base = self._left_base * 0.98 + left_ear * 0.02
        if not right_closed:
            self._right_base = self._right_base * 0.98 + right_ear * 0.02
        return WinkState(left_closed, right_closed, event, self.left_count, self.right_count,
                         left_ear, right_ear)


class FaceTracker:
    # Landmark indices are anatomical: the user's left and right eyes.
    LEFT_EYE = (362, 385, 387, 263, 373, 380)
    RIGHT_EYE = (33, 160, 158, 133, 153, 144)
    LEFT_IRIS = 473
    RIGHT_IRIS = 468

    def __init__(self, closed_ratio: float = 0.75) -> None:
        import cv2
        import mediapipe as mp

        self._cv2 = cv2
        self._mesh = mp.solutions.face_mesh.FaceMesh(
            static_image_mode=False,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self._detector = WinkDetector(closed_ratio)
        self._gaze = GazeEstimator()

    def process(self, frame) -> WinkState:
        rgb = self._cv2.cvtColor(frame, self._cv2.COLOR_BGR2RGB)
        result = self._mesh.process(rgb)
        if not result.multi_face_landmarks:
            self._gaze.reset()
            return self._detector.update(None, None)
        points = result.multi_face_landmarks[0].landmark
        height, width = frame.shape[:2]
        state = self._detector.update(
            _eye_aspect_ratio(points, self.LEFT_EYE, width, height),
            _eye_aspect_ratio(points, self.RIGHT_EYE, width, height),
        )
        gaze = None
        if not state.left_closed and not state.right_closed:
            gaze = self._gaze.update(
                _iris_ratio(points, self.LEFT_EYE, self.LEFT_IRIS),
                _iris_ratio(points, self.RIGHT_EYE, self.RIGHT_IRIS),
            )
        return replace(
            state,
            left_points=tuple((points[index].x, points[index].y) for index in self.LEFT_EYE),
            right_points=tuple((points[index].x, points[index].y) for index in self.RIGHT_EYE),
            gaze=gaze,
        )

    def close(self) -> None:
        self._mesh.close()


def _eye_aspect_ratio(points, indices, width: int, height: int) -> float:
    outer, upper_outer, upper_inner, inner, lower_inner, lower_outer = indices

    def distance(a: int, b: int) -> float:
        return math.hypot((points[a].x - points[b].x) * width,
                          (points[a].y - points[b].y) * height)

    horizontal = max(distance(outer, inner), 1e-6)
    return (distance(upper_outer, lower_outer) + distance(upper_inner, lower_inner)) / (
        2.0 * horizontal)


def _iris_ratio(points, eye, iris: int) -> tuple[float, float]:
    outer, upper_outer, upper_inner, inner, lower_inner, lower_outer = eye
    left, right = sorted((points[outer].x, points[inner].x))
    top = (points[upper_outer].y + points[upper_inner].y) / 2
    bottom = (points[lower_inner].y + points[lower_outer].y) / 2
    top, bottom = sorted((top, bottom))
    return ((points[iris].x - left) / max(right - left, 1e-6),
            (points[iris].y - top) / max(bottom - top, 1e-6))


def _clamp(value: float) -> float:
    return min(1.0, max(0.0, value))
