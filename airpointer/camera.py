from __future__ import annotations

import threading
import time
from collections.abc import Callable

import cv2

from .cursor import CursorController
from .command_gesture import CommandEvent, CommandGesture, CommandView
from .face_tracker import FaceTracker, WinkState
from .gesture import InteractionEngine, Intent
from .gaze import GazeTracker
from .hand_tracker import HandTracker
from .settings import Settings

HAND_CONNECTIONS = (
    (0, 1), (1, 2), (2, 3), (3, 4), (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12), (9, 13), (13, 14), (14, 15),
    (15, 16), (13, 17), (0, 17), (17, 18), (18, 19), (19, 20),
)
START_ZONE_X = 0.4


class CameraLoop:
    def __init__(self, settings: Settings, cursor: CursorController, gaze: GazeTracker,
                 on_frame: Callable[[object | None, tuple[float, float] | None, CommandView], None],
                 on_command: Callable[[CommandEvent], None]) -> None:
        self.settings = settings
        self.cursor = cursor
        self.gaze = gaze
        self.on_frame = on_frame
        self.on_command = on_command
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
        self.on_frame(None, None, CommandView())
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
        face_tracker = FaceTracker(self.settings.wink_sensitivity)
        engine = InteractionEngine(pinch_on=self.settings.pinch_threshold)
        commands = CommandGesture()
        admitted = False
        try:
            while not self._stop.is_set() and capture.isOpened():
                ok, frame = capture.read()
                if not ok:
                    time.sleep(0.05)
                    continue
                tracking_frame = cv2.resize(frame, (320, 180), interpolation=cv2.INTER_AREA)
                points, admitted = _start_gate(tracker.process(tracking_frame), admitted)
                wink = face_tracker.process(frame)
                gaze = self.gaze.update(wink.gaze_features)
                timestamp = time.monotonic()
                command = commands.update(points, timestamp)
                intent = engine.update(points, timestamp)
                if intent.phase == "paused":
                    admitted = False
                if command.blocks_pointer:
                    self.cursor.release()
                else:
                    self.cursor.apply(intent)
                if wink.event and not command.blocks_pointer:
                    self.cursor.eye_click(wink.event)
                if command.event:
                    self.on_command(command.event)
                self.on_frame(_make_preview(frame, points, intent, wink, command), gaze, command)
        finally:
            self.cursor.release()
            self.on_frame(None, None, CommandView())
            tracker.close()
            face_tracker.close()
            capture.release()


def _make_preview(frame, points, intent: Intent, wink: WinkState,
                  command: CommandView = CommandView()):
    preview = cv2.resize(cv2.flip(frame, 1), (320, 180))
    boundary = round(START_ZONE_X * 320)
    shade = preview.copy()
    cv2.rectangle(shade, (0, 0), (boundary, 180), (3, 9, 13), -1)
    preview = cv2.addWeighted(shade, 0.62, preview, 0.38, 0)
    cv2.line(preview, (boundary, 0), (boundary, 180), (68, 229, 255), 1)
    cv2.putText(preview, "START >", (boundary + 5, 174), cv2.FONT_HERSHEY_SIMPLEX,
                0.35, (68, 229, 255), 1, cv2.LINE_AA)
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
    label = ("CAPTURE " + command.phase.upper()) if command.blocks_pointer else intent.phase.upper()
    if intent.pinch_ratio is not None:
        label += f"  PINCH {intent.pinch_ratio:.2f}"
    cv2.putText(preview, label, (9, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.42, color, 1, cv2.LINE_AA)
    _draw_eye(preview, wink.left_points, wink.left_closed)
    _draw_eye(preview, wink.right_points, wink.right_closed)
    if wink.left_ear is None:
        eye_label, eye_color = "EYES --", (120, 120, 120)
    elif wink.event:
        eye_label, eye_color = f"{wink.event.upper()} WINK", (255, 100, 220)
    elif wink.left_closed and wink.right_closed:
        eye_label, eye_color = "BLINK", (120, 120, 120)
    else:
        eye_label = f"E {wink.left_ear:.2f}/{wink.right_ear:.2f}"
        eye_color = (116, 247, 197)
    cv2.putText(preview, eye_label, (205, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.38,
                eye_color, 1, cv2.LINE_AA)
    return cv2.cvtColor(preview, cv2.COLOR_BGR2RGB)


def _draw_eye(frame, points: tuple[tuple[float, float], ...], closed: bool) -> None:
    if not points:
        return
    pixels = [(round((1.0 - x) * 320), round(y * 180)) for x, y in points]
    color = (220, 100, 255) if closed else (255, 229, 68)
    for start, end in zip(pixels, pixels[1:] + pixels[:1]):
        cv2.line(frame, start, end, color, 2, cv2.LINE_AA)
    for point in pixels:
        cv2.circle(frame, point, 2, color, -1, cv2.LINE_AA)


def _start_gate(points, admitted: bool):
    if admitted or not points:
        return points, admitted
    palm_x = sum(points[index].x for index in (0, 5, 9, 13, 17)) / 5
    return (points, True) if palm_x >= START_ZONE_X else (None, False)
