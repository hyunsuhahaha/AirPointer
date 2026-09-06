"""Tracks recent clipboard text, so a capture's prompt can say what the user
copied right before triggering it -- the clipboard counterpart to
window_tracker.py/click_tracker.py's rolling activity logs. Off by default
(Settings.clipboard_history_enabled) since clipboard content is more
sensitive than a window title or clicked button name.

Windows only exposes ONE clipboard slot: copying B overwrites A, so reading
"the clipboard" once at capture time can only ever see the most recent copy,
never a sequence of several. To let a prompt mention "copied A, then B, then
C" at all, this polls for changes continuously (like window/click tracking
already do) and keeps its own short rolling log -- there is no OS-level
multi-item clipboard history this can just ask for.

Polls GetClipboardSequenceNumber() (a counter Windows bumps on every
clipboard content change) rather than opening the clipboard every tick --
cheap enough to poll often, and OpenClipboard()/GetClipboardData() only run
on an actual change.

AirPointer itself writes to the clipboard as part of delivering a capture
(desktop_paste.set_clipboard_files/set_clipboard_text) -- left unguarded,
those writes would show up here as if the user had copied them.
CaptureController brackets each send with suppress_delivery()/
resume_after_delivery() so changes during an in-flight delivery are ignored,
rather than guessing a fixed suppression window."""
from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass

import win32clipboard
import win32con

from .window_tracker import _shorten

_TEXT_LIMIT = 40  # characters kept per copied entry -- a hint for the agent, not a transcript
_TRAILING_GRACE = 0.5  # seconds after resume_after_delivery() during which changes are still ignored,
                       # covering the poll thread observing the final SetClipboardData's sequence
                       # bump slightly after the delivery call that caused it already returned


@dataclass(frozen=True, slots=True)
class ClipboardEvent:
    at: float
    text: str


class ClipboardTracker:
    """Owns a short rolling log of copied text."""

    def __init__(self, retention_seconds: float = 30.0, poll_interval: float = 0.2) -> None:
        self.retention_seconds = retention_seconds
        self.poll_interval = poll_interval
        self._events: deque[ClipboardEvent] = deque()
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._suppressed = False
        self._suppress_grace_until = 0.0
        self._last_sequence: int | None = None

    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def start(self) -> None:
        if self.running:
            return
        self._last_sequence = _sequence_number()
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="airpointer-clipboard-tracker", daemon=True)
        self._thread.start()

    def stop(self, clear: bool = True) -> None:
        self._stop.set()
        if self._thread and self._thread is not threading.current_thread():
            self._thread.join(timeout=2.0)
        if clear:
            with self._lock:
                self._events.clear()

    def suppress_delivery(self) -> None:
        """Call right before a real delivery writes the clipboard (image or
        prompt paste) so that write isn't logged as a user copy."""
        self._suppressed = True

    def resume_after_delivery(self) -> None:
        """Call once a delivery's own clipboard writes are done."""
        self._suppressed = False
        self._suppress_grace_until = time.monotonic() + _TRAILING_GRACE

    def recent_summary(self, seconds: float | None = None) -> str:
        """A single-line, oldest-to-newest chain like 'A → B → C' -- the
        clipboard equivalent of window_tracker's/click_tracker's own
        recent_summary(), for main.App._activity_summary to fold in."""
        cutoff = time.time() - (seconds if seconds is not None else self.retention_seconds)
        with self._lock:
            self._prune(time.time())
            texts = [event.text for event in self._events if event.at >= cutoff]
        return " → ".join(texts)

    def _run(self) -> None:
        while not self._stop.wait(self.poll_interval):
            try:
                self._poll()
            except Exception:
                pass

    def _poll(self) -> None:
        sequence = _sequence_number()
        if sequence is None or sequence == self._last_sequence:
            return
        self._last_sequence = sequence
        if self._suppressed or time.monotonic() < self._suppress_grace_until:
            return
        text = _read_clipboard_text()
        if not text:
            return
        with self._lock:
            self._events.append(ClipboardEvent(time.time(), _shorten(text, _TEXT_LIMIT)))
            self._prune(time.time())

    def _prune(self, now: float) -> None:
        cutoff = now - self.retention_seconds
        while self._events and self._events[0].at < cutoff:
            self._events.popleft()


def _sequence_number() -> int | None:
    try:
        return win32clipboard.GetClipboardSequenceNumber()
    except Exception:
        return None


def _read_clipboard_text() -> str:
    try:
        win32clipboard.OpenClipboard()
    except Exception:
        return ""
    try:
        if not win32clipboard.IsClipboardFormatAvailable(win32con.CF_UNICODETEXT):
            return ""
        data = win32clipboard.GetClipboardData(win32con.CF_UNICODETEXT)
        return data.strip() if isinstance(data, str) else ""
    except Exception:
        return ""
    finally:
        try:
            win32clipboard.CloseClipboard()
        except Exception:
            pass
