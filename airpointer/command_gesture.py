from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .gesture import is_fist, is_open_palm
from .hand_tracker import Point

CommandEvent = Literal["screenshot", "replay"]
CommandPhase = Literal["idle", "arming", "armed", "cooldown"]


@dataclass(frozen=True, slots=True)
class CommandView:
    phase: CommandPhase = "idle"
    progress: float = 0.0
    event: CommandEvent | None = None

    @property
    def blocks_pointer(self) -> bool:
        return self.phase != "idle"


class CommandGesture:
    """Recognizes deliberate capture gestures without performing I/O."""

    def __init__(self, arm_seconds: float = 0.25, hold_seconds: float = 1.2,
                 fist_window: float = 1.0) -> None:
        self.arm_seconds = arm_seconds
        self.hold_seconds = hold_seconds
        self.fist_window = fist_window
        self._phase: CommandPhase = "idle"
        self._palm_since: float | None = None
        self._armed_at: float | None = None

    def update(self, points: list[Point] | None, timestamp: float) -> CommandView:
        if self._phase == "cooldown":
            if not points:
                self._reset()
            return CommandView(self._phase)

        palm = bool(points and is_open_palm(points))
        fist = bool(points and is_fist(points))
        if self._phase == "idle":
            if not palm:
                return CommandView()
            self._phase = "arming"
            self._palm_since = timestamp

        if self._phase == "arming":
            if not palm:
                self._reset()
                return CommandView()
            assert self._palm_since is not None
            elapsed = timestamp - self._palm_since
            if elapsed >= self.arm_seconds:
                self._phase = "armed"
                self._armed_at = timestamp
            return CommandView(self._phase, min(1.0, elapsed / self.arm_seconds))

        assert self._palm_since is not None and self._armed_at is not None
        if fist and timestamp - self._armed_at <= self.fist_window:
            self._phase = "cooldown"
            return CommandView("cooldown", 1.0, "screenshot")
        if palm:
            elapsed = timestamp - self._palm_since
            if elapsed >= self.hold_seconds:
                self._phase = "cooldown"
                return CommandView("cooldown", 1.0, "replay")
            return CommandView("armed", min(1.0, elapsed / self.hold_seconds))
        self._reset()
        return CommandView()

    def _reset(self) -> None:
        self._phase = "idle"
        self._palm_since = self._armed_at = None
