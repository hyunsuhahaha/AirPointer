from __future__ import annotations

import time
from contextlib import nullcontext
from dataclasses import dataclass
from math import hypot

try:
    import uiautomation as auto
except ImportError:  # UI snap stays optional; the rest of AirPointer still works.
    auto = None


INTERACTIVE_TYPES = {
    "ButtonControl",
    "CheckBoxControl",
    "ComboBoxControl",
    "EditControl",
    "HyperlinkControl",
    "ListItemControl",
    "MenuItemControl",
    "RadioButtonControl",
    "TabItemControl",
}


def automation_context():
    """Initialize Windows UI Automation for the calling worker thread."""
    return auto.UIAutomationInitializerInThread() if auto is not None else nullcontext()


@dataclass(frozen=True, slots=True)
class SnapResult:
    x: int
    y: int
    rect: tuple[int, int, int, int]


class UISnapper:
    def __init__(self, radius: int = 80) -> None:
        self.radius = radius
        self._last_scan = 0.0
        self._last_origin = (-10_000, -10_000)
        self._cached: SnapResult | None = None

    @property
    def available(self) -> bool:
        return auto is not None

    def nearest(self, x: int, y: int) -> SnapResult | None:
        if auto is None:
            return None
        now = time.monotonic()
        if now - self._last_scan < 0.12 and hypot(x - self._last_origin[0], y - self._last_origin[1]) < 20:
            return self._cached

        self._last_scan = now
        self._last_origin = (x, y)
        self._cached = self._scan(x, y)
        return self._cached

    def _scan(self, x: int, y: int) -> SnapResult | None:
        r = self.radius
        offsets = ((0, 0), (-r, 0), (r, 0), (0, -r), (0, r), (-r // 2, -r // 2),
                   (r // 2, -r // 2), (-r // 2, r // 2), (r // 2, r // 2))
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
                cx, cy = (rect[0] + rect[2]) // 2, (rect[1] + rect[3]) // 2
                if _distance_to_rect(x, y, rect) <= r:
                    candidates[rect] = SnapResult(cx, cy, rect)
            except Exception:
                continue
        return min(candidates.values(), key=lambda item: hypot(item.x - x, item.y - y), default=None)


def _distance_to_rect(x: int, y: int, rect: tuple[int, int, int, int]) -> float:
    left, top, right, bottom = rect
    dx = max(left - x, 0, x - right)
    dy = max(top - y, 0, y - bottom)
    return hypot(dx, dy)
