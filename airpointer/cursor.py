from __future__ import annotations

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
    pinching: bool
    snap: SnapResult | None


class CursorController:
    def __init__(self, settings: Settings, snapper: UISnapper) -> None:
        self.settings = settings
        self.snapper = snapper
        self.screen_width, self.screen_height = pyautogui.size()
        self._x: float | None = None
        self._y: float | None = None
        self._mouse_down = False

    def update(self, point: Point, pinching: bool) -> CursorState:
        target_x, target_y = self._map(point)
        alpha = self.settings.smoothing
        self._x = target_x if self._x is None else self._x * (1 - alpha) + target_x * alpha
        self._y = target_y if self._y is None else self._y * (1 - alpha) + target_y * alpha
        x, y = int(self._x), int(self._y)

        snap = None
        if self.settings.snap_enabled and not self._mouse_down:
            snap = self.snapper.nearest(x, y)
            if snap:
                x, y = snap.x, snap.y
                self._x, self._y = x, y

        pyautogui.moveTo(x, y, _pause=False)
        if pinching and not self._mouse_down:
            pyautogui.mouseDown(_pause=False)
            self._mouse_down = True
        elif not pinching and self._mouse_down:
            pyautogui.mouseUp(_pause=False)
            self._mouse_down = False
        return CursorState(x, y, pinching, snap)

    def release(self) -> None:
        if self._mouse_down:
            pyautogui.mouseUp(_pause=False)
            self._mouse_down = False

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
