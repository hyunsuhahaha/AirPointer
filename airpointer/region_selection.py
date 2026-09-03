from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Region = tuple[int, int, int, int]
SelectionPhase = Literal["idle", "waiting", "selecting"]


@dataclass(frozen=True, slots=True)
class SelectionView:
    phase: SelectionPhase = "idle"
    rect: Region | None = None

    @property
    def active(self) -> bool:
        return self.phase != "idle"


class RegionSelector:
    """Builds a screen rectangle from a real mouse drag on the overlay window."""

    def __init__(self, min_size: int = 12) -> None:
        self.min_size = min_size
        self._phase: SelectionPhase = "idle"
        self._anchor: tuple[int, int] | None = None
        self._rect: Region | None = None

    @property
    def active(self) -> bool:
        return self._phase != "idle"

    def start(self) -> SelectionView:
        self._phase = "waiting"
        self._anchor = self._rect = None
        return self.view()

    def press(self, x: int, y: int) -> SelectionView:
        if self._phase not in ("waiting", "selecting"):
            return self.view()
        self._anchor = (x, y)
        self._rect = (x, y, x, y)
        self._phase = "selecting"
        return self.view()

    def drag(self, x: int, y: int) -> SelectionView:
        if self._phase != "selecting" or self._anchor is None:
            return self.view()
        self._rect = self._normalize(self._anchor, (x, y))
        return self.view()

    def release(self) -> tuple[SelectionView, Region | None]:
        """Ends the drag. Returns the redrawn view and a captured region, if valid."""
        if self._phase != "selecting":
            return self.view(), None
        if self._valid():
            captured = self._rect
            self.reset()
            return self.view(), captured
        self._phase = "waiting"
        self._anchor = self._rect = None
        return self.view(), None

    def view(self) -> SelectionView:
        return SelectionView(self._phase, self._rect)

    def reset(self) -> None:
        self._phase = "idle"
        self._anchor = self._rect = None

    def _valid(self) -> bool:
        if not self._rect:
            return False
        left, top, right, bottom = self._rect
        return right - left >= self.min_size and bottom - top >= self.min_size

    @staticmethod
    def _normalize(a: tuple[int, int], b: tuple[int, int]) -> Region:
        return min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1])
