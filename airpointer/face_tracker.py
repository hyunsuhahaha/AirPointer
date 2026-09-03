from __future__ import annotations

import math
from dataclasses import dataclass
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


class WinkDetector:
    def __init__(self) -> None:
        self._left_base: float | None = None
        self._right_base: float | None = None
        self._left_run = self._right_run = 0
        self._latched = False
        self.left_count = self.right_count = 0

    def update(self, left_ear: float | None, right_ear: float | None) -> WinkState:
        if left_ear is None or right_ear is None:
            self._left_run = self._right_run = 0
            self._latched = False
            return WinkState(left_count=self.left_count, right_count=self.right_count)

        self._left_base = self._left_base or left_ear
        self._right_base = self._right_base or right_ear
        left_closed = left_ear < self._left_base * 0.60
        right_closed = right_ear < self._right_base * 0.60
        event = None

        if left_closed and not right_closed:
            self._left_run += 1
            self._right_run = 0
            if self._left_run >= 2 and not self._latched:
                event, self._latched = "left", True
                self.left_count += 1
        elif right_closed and not left_closed:
            self._right_run += 1
            self._left_run = 0
            if self._right_run >= 2 and not self._latched:
                event, self._latched = "right", True
                self.right_count += 1
        else:
            self._left_run = self._right_run = 0
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

    def __init__(self) -> None:
        import cv2
        import mediapipe as mp

        self._cv2 = cv2
        self._mesh = mp.solutions.face_mesh.FaceMesh(
            static_image_mode=False,
            max_num_faces=1,
            refine_landmarks=False,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self._detector = WinkDetector()

    def process(self, frame) -> WinkState:
        rgb = self._cv2.cvtColor(frame, self._cv2.COLOR_BGR2RGB)
        result = self._mesh.process(rgb)
        if not result.multi_face_landmarks:
            return self._detector.update(None, None)
        points = result.multi_face_landmarks[0].landmark
        height, width = frame.shape[:2]
        return self._detector.update(
            _eye_aspect_ratio(points, self.LEFT_EYE, width, height),
            _eye_aspect_ratio(points, self.RIGHT_EYE, width, height),
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
