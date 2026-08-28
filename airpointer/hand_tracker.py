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
            max_num_hands=1,
            model_complexity=0,
            min_detection_confidence=0.45,
            min_tracking_confidence=0.45,
        )

    def process(self, frame) -> list[Point] | None:
        rgb = self._cv2.cvtColor(frame, self._cv2.COLOR_BGR2RGB)
        result = self._hands.process(rgb)
        if not result.multi_hand_landmarks:
            return None
        # Mirror x so the hand moves in the same direction as the cursor.
        return [Point(1.0 - p.x, p.y, p.z) for p in result.multi_hand_landmarks[0].landmark]

    def close(self) -> None:
        self._hands.close()
