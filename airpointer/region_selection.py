from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .gesture import is_fist, is_pointing
from .hand_tracker import Point

Region = tuple[int, int, int, int]
SelectionPhase = Literal["idle", "waiting", "selecting", "confirming", "cooldown"]


@dataclass(frozen=True, slots=True)
class SelectionView:
    phase: SelectionPhase = "idle"
    rect: Region | None = None
    pointer: tuple[int, int] | None = None
    progress: float = 0.0
    captured: Region | None = None

    @property
    def active(self) -> bool:
        return self.phase != "idle"


class RegionSelector:
    """Builds a screen rectangle from a pointing finger and confirms it with a fist."""

    def __init__(self, width: int, height: int, min_size: int = 32,
                 confirm_seconds: float = 0.25, cancel_seconds: float = 2.0) -> None:
        self.width = width
        self.height = height
        self.min_size = min_size
        self.confirm_seconds = confirm_seconds
        self.cancel_seconds = cancel_seconds
        self._phase: SelectionPhase = "idle"
        self._anchor: tuple[int, int] | None = None
        self._pointer: tuple[int, int] | None = None
        self._fist_since: float | None = None
        self._missing_since: float | None = None
        self._rect: Region | None = None

    @property
    def active(self) -> bool:
        return self._phase != "idle"

    def start(self) -> SelectionView:
        self._phase = "waiting"
        self._anchor = self._pointer = self._rect = None
        self._fist_since = None
        self._missing_since = None
        return self.view()

    def update(self, points: list[Point] | None, pointer: tuple[int, int] | None,
               timestamp: float) -> SelectionView:
        if self._phase == "idle":
            return SelectionView()
        if self._phase == "cooldown":
            if not points:
                self.reset()
            return self.view()

        if not points:
            if self._missing_since is None:
                self._missing_since = timestamp
            elif timestamp - self._missing_since >= self.cancel_seconds:
                self.reset()
            return self.view()
        self._missing_since = None

        pointing = bool(points and pointer and is_pointing(points))
        if self._phase == "waiting":
            if pointing:
                self._anchor = self._pointer = self._clamp(pointer)
                self._rect = self._normalize(self._anchor, self._pointer)
                self._phase = "selecting"
            return self.view()

        if pointing:
            self._pointer = self._clamp(pointer)
            assert self._anchor is not None
            self._rect = self._normalize(self._anchor, self._pointer)
            self._fist_since = None
            self._phase = "selecting"
            return self.view()

        if points and is_fist(points) and self._valid():
            if self._fist_since is None:
                self._fist_since = timestamp
            elapsed = timestamp - self._fist_since
            self._phase = "confirming"
            if elapsed >= self.confirm_seconds:
                captured = self._rect
                self._phase = "cooldown"
                return SelectionView("cooldown", self._rect, self._pointer, 1.0, captured)
            return SelectionView("confirming", self._rect, self._pointer,
                                 min(1.0, elapsed / self.confirm_seconds))

        self._fist_since = None
        self._missing_since = None
        self._phase = "selecting"
        return self.view()

    def view(self) -> SelectionView:
        return SelectionView(self._phase, self._rect, self._pointer)

    def reset(self) -> None:
        self._phase = "idle"
        self._anchor = self._pointer = self._rect = None
        self._fist_since = None
        self._missing_since = None

    def _valid(self) -> bool:
        if not self._rect:
            return False
        left, top, right, bottom = self._rect
        return right - left >= self.min_size and bottom - top >= self.min_size

    def _clamp(self, point: tuple[int, int]) -> tuple[int, int]:
        return (max(0, min(self.width - 1, point[0])),
                max(0, min(self.height - 1, point[1])))

    @staticmethod
    def _normalize(a: tuple[int, int], b: tuple[int, int]) -> Region:
        return min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1])
