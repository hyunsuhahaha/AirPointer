from __future__ import annotations

import threading
import time
from collections.abc import Callable

import cv2

from .cursor import CursorController
from .gesture import InteractionEngine, Intent
from .hand_tracker import HandTracker
from .settings import Settings

HAND_CONNECTIONS = (
    (0, 1), (1, 2), (2, 3), (3, 4), (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12), (9, 13), (13, 14), (14, 15),
    (15, 16), (13, 17), (0, 17), (17, 18), (18, 19), (19, 20),
)


class CameraLoop:
    def __init__(self, settings: Settings, cursor: CursorController,
                 on_frame: Callable[[object | None], None]) -> None:
        self.settings = settings
        self.cursor = cursor
        self.on_frame = on_frame
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def start(self) -> None:
        if self.running:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="airpointer-camera", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self.cursor.release()
        self.on_frame(None)
        if self._thread and self._thread is not threading.current_thread():
            self._thread.join(timeout=1.0)

    def _run(self) -> None:
        capture = cv2.VideoCapture(self.settings.camera_index, cv2.CAP_DSHOW)
        capture.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        capture.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        capture.set(cv2.CAP_PROP_FRAME_HEIGHT, 360)
        capture.set(cv2.CAP_PROP_FPS, 60)
        capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        tracker = HandTracker()
        engine = InteractionEngine(pinch_on=self.settings.pinch_threshold)
        try:
            while not self._stop.is_set() and capture.isOpened():
                ok, frame = capture.read()
                if not ok:
                    time.sleep(0.05)
                    continue
                tracking_frame = cv2.resize(frame, (320, 180), interpolation=cv2.INTER_AREA)
                points = tracker.process(tracking_frame)
                intent = engine.update(points, time.monotonic())
                self.cursor.apply(intent)
                self.on_frame(_make_preview(frame, points, intent))
        finally:
            self.cursor.release()
            self.on_frame(None)
            tracker.close()
            capture.release()


def _make_preview(frame, points, intent: Intent):
    preview = cv2.resize(cv2.flip(frame, 1), (320, 180))
    colors = {
        "tracking": (214, 215, 68), "pinch": (28, 159, 255), "drag": (255, 100, 220),
        "lost": (120, 120, 120), "paused": (80, 80, 80),
    }
    color = colors[intent.phase]
    if points:
        pixels = [(round(p.x * 320), round(p.y * 180)) for p in points]
        for a, b in HAND_CONNECTIONS:
            cv2.line(preview, pixels[a], pixels[b], color, 1, cv2.LINE_AA)
        for x, y in pixels:
            cv2.circle(preview, (x, y), 2, color, -1, cv2.LINE_AA)
    label = intent.phase.upper()
    if intent.pinch_ratio is not None:
        label += f"  PINCH {intent.pinch_ratio:.2f}"
    cv2.putText(preview, label, (9, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.42, color, 1, cv2.LINE_AA)
    return cv2.cvtColor(preview, cv2.COLOR_BGR2RGB)
