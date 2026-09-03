from __future__ import annotations

import threading
import time
import os
import traceback
from pathlib import Path
from collections.abc import Callable

import cv2

from .cursor import CursorController
from .command_gesture import CommandEvent, CommandGesture, CommandView
from .gesture import InteractionEngine, Intent, classify_pose
from .hand_tracker import HandTracker
from .region_selection import Region, RegionSelector, SelectionView
from .settings import Settings

HAND_CONNECTIONS = (
    (0, 1), (1, 2), (2, 3), (3, 4), (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12), (9, 13), (13, 14), (14, 15),
    (15, 16), (13, 17), (0, 17), (17, 18), (18, 19), (19, 20),
)
START_ZONE_X = 0.4


class CameraLoop:
    def __init__(self, settings: Settings, cursor: CursorController,
                 on_frame: Callable[[object | None, CommandView, SelectionView, str], None],
                 on_command: Callable[[CommandEvent | str, Region | None], None],
                 gesture_flags: Callable[[], tuple[bool, bool, bool]] | None = None) -> None:
        self.settings = settings
        self.cursor = cursor
        self.on_frame = on_frame
        self.on_command = on_command
        self.gesture_flags = gesture_flags or (lambda: (True, True, True))
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
        self.on_frame(None, CommandView(), SelectionView(), "none")
        if self._thread and self._thread is not threading.current_thread():
            self._thread.join(timeout=1.0)

    def _run(self) -> None:
        try:
            self._run_camera()
        except Exception:
            target = Path(os.environ.get("LOCALAPPDATA", ".")) / "AirPointer" / "camera-error.log"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(traceback.format_exc(), encoding="utf-8")
            self.on_frame(None, CommandView(), SelectionView(), "none")

    def _run_camera(self) -> None:
        capture = self._open_camera()
        if capture is None:
            self.on_frame(None, CommandView(), SelectionView(), "none")
            return
        capture.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        capture.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        capture.set(cv2.CAP_PROP_FRAME_HEIGHT, 360)
        capture.set(cv2.CAP_PROP_FPS, 60)
        capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        tracker = HandTracker()
        engine = InteractionEngine(pinch_on=self.settings.pinch_threshold)
        commands = CommandGesture()
        selector = RegionSelector(self.cursor.screen_width, self.cursor.screen_height)
        selection = SelectionView()
        try:
            while not self._stop.is_set() and capture.isOpened():
                ok, frame = capture.read()
                if not ok:
                    time.sleep(0.05)
                    continue
                tracking_frame = cv2.resize(frame, (320, 180), interpolation=cv2.INTER_AREA)
                raw_points = tracker.process(tracking_frame)
                pose = classify_pose(raw_points or [])
                points = raw_points
                timestamp = time.monotonic()
                intent = engine.update(points, timestamp)
                replay_enabled, screenshot_enabled, region_enabled = self.gesture_flags()
                commands.configure(replay_enabled, screenshot_enabled, region_enabled)
                if selector.active:
                    command = CommandView()
                    pointer = self.cursor.project(intent.point) if intent.point else None
                    selection = selector.update(raw_points, pointer, timestamp)
                    if selection.captured:
                        self.on_command("region", selection.captured)
                    if not selector.active:
                        commands.reset()
                else:
                    command = commands.update(raw_points, timestamp)
                    selection = SelectionView()
                    if command.event == "region_select":
                        selection = selector.start()
                    elif command.event:
                        self.on_command(command.event, None)
                if selector.active and selection.phase != "cooldown" and intent.point:
                    self.cursor.apply(intent)
                else:
                    self.cursor.release()
                self.on_frame(_make_preview(frame, points, intent, command, selection),
                              command, selection, pose)
        finally:
            self.cursor.release()
            self.on_frame(None, CommandView(), SelectionView(), "none")
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


def _make_preview(frame, points, intent: Intent,
                  command: CommandView = CommandView(), selection: SelectionView = SelectionView()):
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
    if command.blocks_pointer:
        label = "PALM " + command.phase.upper()
    else:
        label = intent.phase.upper()
    if intent.pinch_ratio is not None:
        label += f"  PINCH {intent.pinch_ratio:.2f}"
    cv2.putText(preview, label, (9, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.42, color, 1, cv2.LINE_AA)
    return cv2.cvtColor(preview, cv2.COLOR_BGR2RGB)


def _start_gate(points, admitted: bool):
    if admitted or not points:
        return points, admitted
    palm_x = sum(points[index].x for index in (0, 5, 9, 13, 17)) / 5
    return (points, True) if palm_x >= START_ZONE_X else (None, False)
