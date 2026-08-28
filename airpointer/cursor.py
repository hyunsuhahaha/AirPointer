from __future__ import annotations

import threading
from dataclasses import dataclass

import pyautogui

from .hand_tracker import Point
from .settings import Settings
from .ui_snap import SnapResult, UISnapper

pyautogui.PAUSE = 0
pyautogui.FAILSAFE = False


@dataclass(frozen=True, slots=True)
class CursorState:
    x: int
    y: int
    point_x: int
    point_y: int
    pinching: bool
    snap: SnapResult | None


class CursorController:
    def __init__(self, settings: Settings, snapper: UISnapper) -> None:
        self.settings = settings
        self.snapper = snapper
        self.screen_width, self.screen_height = pyautogui.size()
        start = pyautogui.position()
        self._x, self._y = float(start.x), float(start.y)
        self._point_x, self._point_y = self._x, self._y
        self._target_x, self._target_y = self._x, self._y
        self._point_target_x, self._point_target_y = self._x, self._y
        self._state: CursorState | None = None
        self._mouse_down = False
        self._active = False
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._animate, name="airpointer-cursor", daemon=True)
        self._thread.start()

    def update(self, point: Point, pinching: bool) -> CursorState:
        point_x, point_y = self._map(point)
        x, y = point_x, point_y

        snap = None
        if self.settings.snap_enabled and not self._mouse_down:
            snap = self.snapper.nearest(x, y)
            if snap:
                x, y = snap.x, snap.y

        state = CursorState(x, y, point_x, point_y, pinching, snap)
        with self._lock:
            self._target_x, self._target_y = x, y
            self._point_target_x, self._point_target_y = point_x, point_y
            self._state = state
            self._active = True
        if pinching and not self._mouse_down:
            pyautogui.moveTo(x, y, _pause=False)
            with self._lock:
                self._x, self._y = x, y
            pyautogui.mouseDown(_pause=False)
            self._mouse_down = True
        elif not pinching and self._mouse_down:
            pyautogui.mouseUp(_pause=False)
            self._mouse_down = False
        return state

    def release(self) -> None:
        with self._lock:
            self._active = False
            self._state = None
        if self._mouse_down:
            pyautogui.mouseUp(_pause=False)
            self._mouse_down = False

    def current_state(self) -> CursorState | None:
        with self._lock:
            if not self._active or self._state is None:
                return None
            state = self._state
            return CursorState(state.x, state.y, round(self._point_x), round(self._point_y),
                               state.pinching, state.snap)

    def close(self) -> None:
        self.release()
        self._stop.set()
        self._thread.join(timeout=0.2)

    def _animate(self) -> None:
        while not self._stop.wait(1 / 120):
            with self._lock:
                if not self._active:
                    continue
                alpha = self.settings.smoothing
                self._x += (self._target_x - self._x) * alpha
                self._y += (self._target_y - self._y) * alpha
                self._point_x += (self._point_target_x - self._point_x) * alpha
                self._point_y += (self._point_target_y - self._point_y) * alpha
                x, y = round(self._x), round(self._y)
            pyautogui.moveTo(x, y, _pause=False)

    def _map(self, point: Point) -> tuple[int, int]:
        span_x = 0.70 / self.settings.sensitivity
        span_y = 0.60 / self.settings.sensitivity
        left, top = 0.5 - span_x / 2, 0.5 - span_y / 2
        x = (point.x - left) / span_x * self.screen_width
        y = (point.y - top) / span_y * self.screen_height
        return (
            max(0, min(self.screen_width - 1, int(x))),
            max(0, min(self.screen_height - 1, int(y))),
        )
