from __future__ import annotations

import threading
import time
import os
import traceback
from pathlib import Path
from collections.abc import Callable

import cv2

from .command_gesture import CommandEvent, CommandGesture, CommandView
from .gesture import classify_pose
from .hand_tracker import HandTracker
from .settings import Settings

HAND_CONNECTIONS = (
    (0, 1), (1, 2), (2, 3), (3, 4), (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12), (9, 13), (13, 14), (14, 15),
    (15, 16), (13, 17), (0, 17), (17, 18), (18, 19), (19, 20),
)


class CameraLoop:
    def __init__(self, settings: Settings,
                 on_frame: Callable[[object | None, CommandView, str], None],
                 on_command: Callable[[CommandEvent, None], None],
                 gesture_flags: Callable[[], tuple[bool, bool, bool]] | None = None,
                 is_selecting: Callable[[], bool] | None = None) -> None:
        self.settings = settings
        self.on_frame = on_frame
        self.on_command = on_command
        self.gesture_flags = gesture_flags or (lambda: (True, True, True))
        self.is_selecting = is_selecting or (lambda: False)
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
        self.on_frame(None, CommandView(), "none")
        if self._thread and self._thread is not threading.current_thread():
            self._thread.join(timeout=1.0)

    def _run(self) -> None:
        try:
            self._run_camera()
        except Exception:
            target = Path(os.environ.get("LOCALAPPDATA", ".")) / "AirPointer" / "camera-error.log"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(traceback.format_exc(), encoding="utf-8")
            self.on_frame(None, CommandView(), "none")

    def _run_camera(self) -> None:
        capture = self._open_camera()
        if capture is None:
            self.on_frame(None, CommandView(), "none")
            return
        capture.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        capture.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        capture.set(cv2.CAP_PROP_FRAME_HEIGHT, 360)
        capture.set(cv2.CAP_PROP_FPS, 60)
        capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        tracker = HandTracker()
        commands = CommandGesture()
        try:
            while not self._stop.is_set() and capture.isOpened():
                ok, frame = capture.read()
                if not ok:
                    time.sleep(0.05)
                    continue
                tracking_frame = cv2.resize(frame, (320, 180), interpolation=cv2.INTER_AREA)
                raw_points = tracker.process(tracking_frame)
                pose = classify_pose(raw_points or [])
                timestamp = time.monotonic()
                replay_enabled, screenshot_enabled, region_enabled = self.gesture_flags()
                commands.configure(replay_enabled, screenshot_enabled, region_enabled)
                if self.is_selecting():
                    # A region-selection drag is in progress on the main thread;
                    # don't let hand gestures fire another command underneath it.
                    command = CommandView()
                else:
                    command = commands.update(raw_points, timestamp)
                    if command.event:
                        self.on_command(command.event, None)
                self.on_frame(_make_preview(frame, raw_points, pose, command), command, pose)
        finally:
            self.on_frame(None, CommandView(), "none")
            tracker.close()
            capture.release()

    def _open_camera(self):
        """Open a Windows camera even when a browser has just requested access."""
        backends = (cv2.CAP_MSMF, cv2.CAP_DSHOW)
        while not self._stop.is_set():
            for backend in backends:
                capture = cv2.VideoCapture(self.settings.camera_index, backend)
                if capture.isOpened():
                    return capture
                capture.release()
            self._stop.wait(0.5)
        return None


_POSE_COLORS = {
    "palm": (74, 247, 197), "fist": (46, 176, 255), "point": (255, 229, 68),
    "other": (120, 120, 120), "none": (80, 80, 80),
}


def _make_preview(frame, points, pose: str, command: CommandView = CommandView()):
    preview = cv2.resize(cv2.flip(frame, 1), (320, 180))
    color = _POSE_COLORS.get(pose, _POSE_COLORS["none"])
    if points:
        pixels = [(round(p.x * 320), round(p.y * 180)) for p in points]
        for a, b in HAND_CONNECTIONS:
            cv2.line(preview, pixels[a], pixels[b], color, 1, cv2.LINE_AA)
        for x, y in pixels:
            cv2.circle(preview, (x, y), 2, color, -1, cv2.LINE_AA)
    label = f"PALM {command.phase.upper()}" if command.blocks_pointer else pose.upper()
    cv2.putText(preview, label, (9, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.42, color, 1, cv2.LINE_AA)
    return cv2.cvtColor(preview, cv2.COLOR_BGR2RGB)
