from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .gesture import classify_pose
from .hand_tracker import Point

CommandEvent = Literal["screenshot", "replay", "region_select"]
CommandPhase = Literal["idle", "arming", "armed", "cooldown"]
CommandRoute = Literal["screenshot", "replay", "region"]


@dataclass(frozen=True, slots=True)
class CommandView:
    phase: CommandPhase = "idle"
    progress: float = 0.0
    event: CommandEvent | None = None
    route: CommandRoute | None = None

    @property
    def blocks_pointer(self) -> bool:
        return self.phase != "idle"


class CommandGesture:
    """Recognizes deliberate capture gestures without performing I/O."""

    def __init__(self, arm_seconds: float = 0.12, hold_seconds: float = 2.0,
                 transition_grace: float = 0.35) -> None:
        self.arm_seconds = arm_seconds
        self.hold_seconds = hold_seconds
        self.transition_grace = transition_grace
        self._phase: CommandPhase = "idle"
        self._palm_since: float | None = None
        self._last_palm_at: float | None = None
        self._route: CommandRoute | None = None
        self.replay_enabled = True
        self.screenshot_enabled = True
        self.region_enabled = True

    def configure(self, replay: bool, screenshot: bool, region: bool) -> None:
        self.replay_enabled = replay
        self.screenshot_enabled = screenshot
        self.region_enabled = region
        if ((self._route == "replay" and not (replay or screenshot)) or
                (self._route == "region" and not region)):
            self._reset()

    def update(self, points: list[Point] | None, timestamp: float) -> CommandView:
        if self._phase == "cooldown":
            if not points:
                self._reset()
            return CommandView(self._phase)

        pose = classify_pose(points or [])
        palm = pose == "palm"
        fist = pose == "fist"

        if self._phase == "idle":
            if fist and self.region_enabled:
                self._phase = "arming"
                self._palm_since = timestamp
                self._last_palm_at = timestamp
                self._route = "region"
            elif palm and (self.replay_enabled or self.screenshot_enabled):
                self._phase = "arming"
                self._palm_since = timestamp
                self._last_palm_at = timestamp
                self._route = "replay"
            else:
                return CommandView()

        assert self._palm_since is not None
        elapsed = timestamp - self._palm_since
        if self._route == "region":
            if palm and elapsed <= self.hold_seconds:
                self._phase = "cooldown"
                return CommandView("cooldown", 1.0, "region_select", "region")
            if fist:
                self._last_palm_at = timestamp
                self._phase = "armed" if elapsed >= self.arm_seconds else "arming"
                return CommandView(self._phase, min(1.0, elapsed / self.hold_seconds), route="region")
            if self._last_palm_at is not None and timestamp - self._last_palm_at <= self.transition_grace:
                return CommandView(self._phase, min(1.0, elapsed / self.hold_seconds), route="region")
            self._reset()
            return CommandView()
        if fist and self.screenshot_enabled and elapsed <= self.hold_seconds:
            self._phase = "cooldown"
            return CommandView("cooldown", 1.0, "screenshot", "screenshot")
        if palm:
            self._last_palm_at = timestamp
            if elapsed >= self.hold_seconds and self.replay_enabled:
                self._phase = "cooldown"
                return CommandView("cooldown", 1.0, "replay", "replay")
            if elapsed >= self.hold_seconds:
                self._reset()
                return CommandView()
            self._phase = "armed" if elapsed >= self.arm_seconds else "arming"
            return CommandView(self._phase, min(1.0, elapsed / self.hold_seconds), route="replay")
        if self._last_palm_at is not None and timestamp - self._last_palm_at <= self.transition_grace:
            return CommandView(self._phase, min(1.0, elapsed / self.hold_seconds), route="replay")
        self._reset()
        return CommandView()

    def reset(self) -> None:
        self._reset()

    def _reset(self) -> None:
        self._phase = "idle"
        self._palm_since = self._last_palm_at = None
        self._route = None
