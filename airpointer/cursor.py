from __future__ import annotations

import math
import threading
from dataclasses import dataclass

import pyautogui

from .gesture import Intent
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
    mode: str = "tracking"
    confidence: float = 1.0


class CursorController:
    """Maps interaction intent to absolute pointing or optional relative input."""

    def __init__(self, settings: Settings, snapper: UISnapper) -> None:
        self.settings = settings
        self.snapper = snapper
        self.screen_width, self.screen_height = pyautogui.size()
        start = pyautogui.position()
        self._x, self._y = float(start.x), float(start.y)
        self._point_x, self._point_y = self._x, self._y
        self._target_x, self._target_y = self._x, self._y
        self._point_target_x, self._point_target_y = self._x, self._y
        self._last_hand: Point | None = None
        self._pinch_target: tuple[int, int] | None = None
        self._captured_snap: SnapResult | None = None
        self._state: CursorState | None = None
        self._mouse_down = False
        self._active = False
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._animate, name="airpointer-cursor", daemon=True)
        self._thread.start()

    def apply(self, intent: Intent) -> CursorState | None:
        if intent.phase == "paused":
            self.release()
            return None
        if intent.phase == "lost":
            with self._lock:
                if self._state:
                    state = self._state
                    self._state = CursorState(state.x, state.y, state.point_x, state.point_y,
                                              state.pinching, state.snap, "lost", intent.confidence)
            return self.current_state()

        assert intent.point is not None
        if intent.event == "click":
            return self._click(intent)
        if intent.event == "drag_end":
            self._mouse_up()
            self._pinch_target = None
            self._captured_snap = None
            self._last_hand = intent.palm or intent.point

        if intent.phase == "pinch":
            return self._hold_pinch(intent)

        if intent.phase == "drag":
            if intent.event == "drag_start":
                self._start_drag()
            x, y = self._drag_target(intent)
            return self._set_target(x, y, None, "drag", True)

        x, y = self._pointer_target(intent.point)
        snap = self.snapper.nearest(x, y) if self.settings.snap_enabled else None
        mode = "hover" if snap else "tracking"
        state = self._set_target(x, y, snap, mode, False)
        self._pinch_target = None
        self._captured_snap = None
        return state

    def release(self) -> None:
        with self._lock:
            self._active = False
            self._state = None
        self._last_hand = None
        self._pinch_target = None
        self._captured_snap = None
        self._mouse_up()

    def current_state(self) -> CursorState | None:
        with self._lock:
            if not self._active or self._state is None:
                return None
            state = self._state
            return CursorState(state.x, state.y, round(self._point_x), round(self._point_y),
                               state.pinching, state.snap, state.mode, state.confidence)

    def close(self) -> None:
        self.release()
        self._stop.set()
        self._thread.join(timeout=0.2)
        self.snapper.close()

    def _hold_pinch(self, intent: Intent) -> CursorState:
        assert intent.point is not None
        if self._pinch_target is None:
            raw_x, raw_y = self._pointer_target(intent.point)
            snap = self.snapper.nearest(raw_x, raw_y) if self.settings.snap_enabled else None
            self._captured_snap = snap
            self._pinch_target = (snap.x, snap.y) if snap else (raw_x, raw_y)
            self._last_hand = intent.palm or intent.point
        with self._lock:
            hold_x, hold_y = round(self._x), round(self._y)
        return self._set_target(hold_x, hold_y, self._captured_snap, "pinch", True,
                                semantic_target=self._pinch_target)

    def _click(self, intent: Intent) -> CursorState:
        assert intent.point is not None
        x, y = self._pinch_target or (round(self._target_x), round(self._target_y))
        pyautogui.moveTo(x, y, _pause=False)
        pyautogui.click(_pause=False)
        with self._lock:
            self._x = self._point_x = self._target_x = self._point_target_x = x
            self._y = self._point_y = self._target_y = self._point_target_y = y
        snap = self._captured_snap
        self._pinch_target = None
        self._captured_snap = None
        self._last_hand = intent.palm or intent.point
        return self._set_target(x, y, snap, "click", False)

    def _start_drag(self) -> None:
        x, y = self._pinch_target or (round(self._target_x), round(self._target_y))
        pyautogui.moveTo(x, y, _pause=False)
        pyautogui.mouseDown(_pause=False)
        self._mouse_down = True
        with self._lock:
            self._x = self._point_x = self._target_x = self._point_target_x = x
            self._y = self._point_y = self._target_y = self._point_target_y = y

    def _mouse_up(self) -> None:
        if self._mouse_down:
            pyautogui.mouseUp(_pause=False)
            self._mouse_down = False

    def _relative_target(self, point: Point) -> tuple[int, int]:
        if self._last_hand is None:
            self._last_hand = point
            return round(self._target_x), round(self._target_y)
        dx, dy = point.x - self._last_hand.x, point.y - self._last_hand.y
        self._last_hand = point
        speed = math.hypot(dx, dy)
        gain = self.settings.sensitivity * (1.6 + min(speed * 20.0, 1.4))
        with self._lock:
            x = self._target_x + dx * self.screen_width * gain
            y = self._target_y + dy * self.screen_height * gain
        return (
            max(0, min(self.screen_width - 1, round(x))),
            max(0, min(self.screen_height - 1, round(y))),
        )

    def _pointer_target(self, point: Point) -> tuple[int, int]:
        if self.settings.mapping_mode == "relative":
            return self._relative_target(point)
        self._last_hand = None
        span_x = max(0.35, min(0.9, 0.70 / self.settings.sensitivity))
        span_y = max(0.30, min(0.85, 0.60 / self.settings.sensitivity))
        left, top = (1.0 - span_x) / 2.0, (1.0 - span_y) / 2.0
        x = (point.x - left) / span_x * (self.screen_width - 1)
        y = (point.y - top) / span_y * (self.screen_height - 1)
        return (
            max(0, min(self.screen_width - 1, round(x))),
            max(0, min(self.screen_height - 1, round(y))),
        )

    def _drag_target(self, intent: Intent) -> tuple[int, int]:
        assert intent.point is not None
        # Palm deltas avoid the cursor jump caused by bending the index finger to pinch.
        return self._relative_target(intent.palm or intent.point)

    def _set_target(self, x: int, y: int, snap: SnapResult | None, mode: str,
                    pinching: bool, semantic_target: tuple[int, int] | None = None) -> CursorState:
        sx, sy = semantic_target or ((snap.x, snap.y) if snap else (x, y))
        state = CursorState(sx, sy, x, y, pinching, snap, mode)
        with self._lock:
            self._target_x, self._target_y = x, y
            self._point_target_x, self._point_target_y = x, y
            self._state = state
            self._active = True
        return state

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
