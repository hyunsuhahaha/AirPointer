from __future__ import annotations

import threading
import time
from collections.abc import Callable

import cv2

from .cursor import CursorController
from .gesture import recognize
from .hand_tracker import HandTracker
from .settings import Settings
from .ui_snap import automation_context


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

    def _run(self) -> None:
        capture = cv2.VideoCapture(self.settings.camera_index, cv2.CAP_DSHOW)
        capture.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        capture.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        tracker = HandTracker()
        try:
            with automation_context():
                while not self._stop.is_set() and capture.isOpened():
                    ok, frame = capture.read()
                    if not ok:
                        time.sleep(0.05)
                        continue
                    preview = cv2.resize(cv2.flip(frame, 1), (320, 180))
                    self.on_frame(cv2.cvtColor(preview, cv2.COLOR_BGR2RGB))
                    points = tracker.process(frame)
                    if not points:
                        self.cursor.release()
                        continue
                    gesture = recognize(points, self.settings.pinch_threshold)
                    if gesture.paused or not gesture.pointing:
                        self.cursor.release()
                        continue
                    self.cursor.update(gesture.index_tip, gesture.pinching)
        finally:
            self.cursor.release()
            self.on_frame(None)
            tracker.close()
            capture.release()
