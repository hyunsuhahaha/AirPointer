from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Point:
    x: float
    y: float
    z: float = 0.0


class HandTracker:
    def __init__(self) -> None:
        import cv2
        import mediapipe as mp

        self._cv2 = cv2
        self._hands = mp.solutions.hands.Hands(
            static_image_mode=False,
            max_num_hands=2,
            model_complexity=0,
            min_detection_confidence=0.45,
            min_tracking_confidence=0.45,
        )

    def process(self, frame) -> list[Point] | None:
        # MediaPipe handedness labels assume a mirrored selfie image.
        rgb = self._cv2.cvtColor(self._cv2.flip(frame, 1), self._cv2.COLOR_BGR2RGB)
        result = self._hands.process(rgb)
        if not result.multi_hand_landmarks:
            return None
        candidates = [
            (handedness.classification[0].label,
             [Point(point.x, point.y, point.z) for point in landmarks.landmark])
            for landmarks, handedness in zip(result.multi_hand_landmarks, result.multi_handedness)
        ]
        return _select_right_hand(candidates)

    def close(self) -> None:
        self._hands.close()


def _select_right_hand(candidates: list[tuple[str, list[Point]]]) -> list[Point] | None:
    if not candidates:
        return None
    # Prefer the right hand for pointer control, but never discard the only
    # visible hand. MediaPipe handedness can also flip with camera mirroring.
    return next((points for label, points in candidates if label == "Right"), candidates[0][1])
