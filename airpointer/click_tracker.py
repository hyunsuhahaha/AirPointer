"""Tracks which UI control the user clicked, so a capture's prompt can say
what they pressed without the AI having to guess from pixels -- the click
counterpart to window_tracker.py's foreground-window log.

Polling GetAsyncKeyState (not a WH_MOUSE_LL hook) for the same reason
window_tracker.py polls the foreground window instead of a win event hook:
a low-level hook needs a message pump running on the hooking thread, which
means either routing through Tk's own loop (risking UI stalls if a callback
is slow) or standing up a second COM message loop. GetAsyncKeyState needs
neither -- it works from any thread with no message queue of its own.
Clicks need a tighter poll than window switches to not miss a fast one, but
a plain state check is cheap enough that 50/sec on a daemon thread costs
nothing measurable; the heavier UIA lookup only runs on an actual click."""
from __future__ import annotations

import os
import threading
import time
from collections import deque
from dataclasses import dataclass

import win32api
import win32con
import win32gui
import win32process
from pywinauto.uia_element_info import UIAElementInfo

from .window_tracker import _app_name, _shorten


@dataclass(frozen=True, slots=True)
class ClickEvent:
    at: float
    app: str
    control: str


class ClickTracker:
    """Owns a short rolling log of left-click targets, identified by the
    accessible name of whatever UI Automation element was under the cursor
    at the moment of the click (a button label, menu item, etc.)."""

    def __init__(self, retention_seconds: float = 30.0, poll_interval: float = 0.02) -> None:
        self.retention_seconds = retention_seconds
        self.poll_interval = poll_interval
        self._events: deque[ClickEvent] = deque()
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._own_pid = os.getpid()

    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def start(self) -> None:
        if self.running:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="airpointer-click-tracker", daemon=True)
        self._thread.start()

    def stop(self, clear: bool = True) -> None:
        self._stop.set()
        if self._thread and self._thread is not threading.current_thread():
            self._thread.join(timeout=2.0)
        if clear:
            with self._lock:
                self._events.clear()

    def recent_summary(self, seconds: float | None = None, max_entries: int = 4,
                       title_limit: int = 40) -> str:
        """A single-line, oldest-to-newest chain like window_tracker's:
        '14:32:01 Chrome · "뒤로" 클릭 → 14:32:05 VS Code · "실행" 클릭 (현재)'"""
        cutoff = time.time() - (seconds if seconds is not None else self.retention_seconds)
        with self._lock:
            events = [event for event in self._events if event.at >= cutoff]
        if not events:
            return ""
        trimmed = events[-max_entries:]
        parts = []
        for index, event in enumerate(trimmed):
            stamp = time.strftime("%H:%M:%S", time.localtime(event.at))
            control = _shorten(event.control, title_limit)
            label = f'{stamp} {event.app} · "{control}" 클릭' if control else f"{stamp} {event.app} 클릭"
            if index == len(trimmed) - 1:
                label += " (현재)"
            parts.append(label)
        return " → ".join(parts)

    def _run(self) -> None:
        was_down = False
        while not self._stop.is_set():
            try:
                is_down = bool(win32api.GetAsyncKeyState(win32con.VK_LBUTTON) & 0x8000)
                if is_down and not was_down:
                    self._record_click()
                was_down = is_down
            except Exception:
                pass
            self._stop.wait(self.poll_interval)

    def _record_click(self) -> None:
        try:
            x, y = win32gui.GetCursorPos()
            hwnd = win32gui.WindowFromPoint((x, y))
            if not hwnd:
                return
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            if not pid or pid == self._own_pid:
                return
            app = _app_name(pid)
            control = _element_name_at(x, y, hwnd)
            if not app and not control:
                return
        except Exception:
            return
        with self._lock:
            self._events.append(ClickEvent(time.time(), app, control))
            self._prune()

    def _prune(self) -> None:
        cutoff = time.time() - self.retention_seconds
        while self._events and self._events[0].at < cutoff:
            self._events.popleft()


def _element_name_at(x: int, y: int, window_hwnd: int) -> str:
    """Best-effort accessible name of whatever's under the cursor. A raw
    hit-test often lands on an anonymous layout pane with no name, so climb
    a few parents looking for one before giving up -- named controls are
    frequently wrapped in one or two unnamed containers. Stops at
    `window_hwnd` (the top-level window WindowFromPoint already identified)
    rather than falling back to its title: "clicked window X" duplicates
    what window_tracker.py already reports and isn't "what was clicked"."""
    try:
        element = UIAElementInfo.from_point(x, y)
    except Exception:
        return ""
    for _ in range(4):
        if element is None:
            return ""
        try:
            if element.handle == window_hwnd:
                return ""
            name = (element.name or "").strip()
        except Exception:
            return ""
        if name:
            return name
        try:
            element = element.parent
        except Exception:
            return ""
    return ""
