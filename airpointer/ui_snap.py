from __future__ import annotations

import threading
from contextlib import nullcontext
from dataclasses import dataclass
from math import hypot

try:
    import uiautomation as auto
except ImportError:
    auto = None


INTERACTIVE_TYPES = {
    "ButtonControl", "CheckBoxControl", "ComboBoxControl", "EditControl",
    "HyperlinkControl", "ListItemControl", "MenuItemControl",
    "RadioButtonControl", "TabItemControl",
}


def automation_context():
    return auto.UIAutomationInitializerInThread() if auto is not None else nullcontext()


@dataclass(frozen=True, slots=True)
class SnapResult:
    x: int
    y: int
    rect: tuple[int, int, int, int]


class UISnapper:
    """Scans UI Automation off the tracking path and exposes a stable hover lock."""

    def __init__(self, radius: int = 80) -> None:
        self.radius = radius
        self._request = (-10_000, -10_000)
        self._locked_rect: tuple[int, int, int, int] | None = None
        self._pending_rect: tuple[int, int, int, int] | None = None
        self._pending_frames = 0
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        if auto is not None:
            self._thread = threading.Thread(target=self._run, name="airpointer-uia", daemon=True)
            self._thread.start()

    @property
    def available(self) -> bool:
        return auto is not None

    def nearest(self, x: int, y: int) -> SnapResult | None:
        if auto is None:
            return None
        with self._lock:
            self._request = (x, y)
            rect = self._locked_rect
        self._wake.set()
        if rect is None or _distance_to_rect(x, y, rect) > self.radius * 1.5:
            return None
        sx, sy = _snap_point(x, y, rect)
        return SnapResult(sx, sy, rect)

    def close(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread:
            self._thread.join(timeout=0.5)

    def _run(self) -> None:
        with automation_context():
            while not self._stop.is_set():
                self._wake.wait()
                self._wake.clear()
                if self._stop.is_set():
                    break
                with self._lock:
                    x, y = self._request
                candidate = self._scan(x, y)
                self._update_lock(x, y, candidate)
                self._stop.wait(0.08)

    def _update_lock(self, x: int, y: int, candidate: SnapResult | None) -> None:
        with self._lock:
            if self._locked_rect and _distance_to_rect(x, y, self._locked_rect) <= self.radius * 1.5:
                return
            self._locked_rect = None
            rect = candidate.rect if candidate else None
            if rect is None:
                self._pending_rect, self._pending_frames = None, 0
            elif rect == self._pending_rect:
                self._pending_frames += 1
                if self._pending_frames >= 2:
                    self._locked_rect = rect
            else:
                self._pending_rect, self._pending_frames = rect, 1

    def _scan(self, x: int, y: int) -> SnapResult | None:
        r = self.radius
        offsets = ((0, 0), (-r, 0), (r, 0), (0, -r), (0, r),
                   (-r // 2, -r // 2), (r // 2, -r // 2),
                   (-r // 2, r // 2), (r // 2, r // 2))
        candidates: dict[tuple[int, int, int, int], SnapResult] = {}
        for dx, dy in offsets:
            try:
                control = auto.ControlFromPoint(x + dx, y + dy)
                while control and control.ControlTypeName not in INTERACTIVE_TYPES:
                    control = control.GetParentControl()
                if not control:
                    continue
                box = control.BoundingRectangle
                rect = (int(box.left), int(box.top), int(box.right), int(box.bottom))
                if _distance_to_rect(x, y, rect) <= r:
                    sx, sy = _snap_point(x, y, rect)
                    candidates[rect] = SnapResult(sx, sy, rect)
            except Exception:
                continue
        return min(candidates.values(), key=lambda item: hypot(item.x - x, item.y - y), default=None)


def _distance_to_rect(x: int, y: int, rect: tuple[int, int, int, int]) -> float:
    left, top, right, bottom = rect
    dx = max(left - x, 0, x - right)
    dy = max(top - y, 0, y - bottom)
    return hypot(dx, dy)


def _snap_point(x: int, y: int, rect: tuple[int, int, int, int]) -> tuple[int, int]:
    left, top, right, bottom = rect
    margin = min(4, max(0, (right - left) // 2), max(0, (bottom - top) // 2))
    return (
        max(left + margin, min(x, right - margin)),
        max(top + margin, min(y, bottom - margin)),
    )
