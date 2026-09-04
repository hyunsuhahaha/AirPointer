"""Tracks which window the user had focused, so a capture's prompt can say
what app/page they were on without the AI having to guess from pixels.

Polling (not SetWinEventHook) on purpose: a Win32 event hook needs a
message pump running on the hooking thread, which would mean either
routing it through Tk's own loop (risking UI stalls if a callback is
slow) or standing up a second COM message loop. A 1-second poll on a
plain daemon thread costs nothing measurable and matches the screen
buffer's own 1-second segment cadence."""
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

# Recognizable app names beat raw executable names ("Code.exe") in a
# prompt meant to be read by a model, not a sysadmin. Not exhaustive --
# anything missing just falls back to the exe name with ".exe" stripped.
_FRIENDLY_NAMES = {
    "code.exe": "VS Code",
    "chrome.exe": "Chrome",
    "msedge.exe": "Edge",
    "firefox.exe": "Firefox",
    "windowsterminal.exe": "Windows Terminal",
    "powershell.exe": "PowerShell",
    "pwsh.exe": "PowerShell",
    "cmd.exe": "명령 프롬프트",
    "explorer.exe": "탐색기",
    "notepad.exe": "메모장",
    "slack.exe": "Slack",
    "discord.exe": "Discord",
    "outlook.exe": "Outlook",
}


@dataclass(frozen=True, slots=True)
class WindowEvent:
    at: float
    app: str
    title: str


class WindowTracker:
    """Owns a short rolling log of foreground-window changes."""

    def __init__(self, retention_seconds: float = 30.0, poll_interval: float = 1.0) -> None:
        self.retention_seconds = retention_seconds
        self.poll_interval = poll_interval
        self._events: deque[WindowEvent] = deque()
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_key: tuple[str, str] | None = None
        self._own_pid = os.getpid()

    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def start(self) -> None:
        if self.running:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="airpointer-window-tracker", daemon=True)
        self._thread.start()

    def stop(self, clear: bool = True) -> None:
        self._stop.set()
        if self._thread and self._thread is not threading.current_thread():
            self._thread.join(timeout=2.0)
        if clear:
            with self._lock:
                self._events.clear()
            self._last_key = None

    def recent_summary(self, seconds: float | None = None, max_entries: int = 4,
                       title_limit: int = 40) -> str:
        """A single-line, oldest-to-newest chain like:
        '14:31:58 VS Code · main.py → 14:32:15 Chrome · Stack Overflow (현재)'
        Capped to the last few switches so it stays a handful of tokens
        instead of dumping the whole buffer into the prompt."""
        cutoff = time.time() - (seconds if seconds is not None else self.retention_seconds)
        with self._lock:
            events = [event for event in self._events if event.at >= cutoff]
        if not events:
            return ""
        trimmed = events[-max_entries:]
        parts = []
        for index, event in enumerate(trimmed):
            stamp = time.strftime("%H:%M:%S", time.localtime(event.at))
            title = _shorten(event.title, title_limit)
            label = f"{stamp} {event.app} · {title}" if title else f"{stamp} {event.app}"
            if index == len(trimmed) - 1:
                label += " (현재)"
            parts.append(label)
        return " → ".join(parts)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self._poll()
            except Exception:
                pass
            self._stop.wait(self.poll_interval)

    def _poll(self) -> None:
        hwnd = win32gui.GetForegroundWindow()
        if not hwnd:
            return
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        if not pid or pid == self._own_pid:
            return
        title = win32gui.GetWindowText(hwnd).strip()
        app = _app_name(pid)
        if not app and not title:
            return
        key = (app, title)
        if key == self._last_key:
            return
        self._last_key = key
        with self._lock:
            self._events.append(WindowEvent(time.time(), app, title))
            self._prune()

    def _prune(self) -> None:
        cutoff = time.time() - self.retention_seconds
        while self._events and self._events[0].at < cutoff:
            self._events.popleft()


def _app_name(pid: int) -> str:
    handle = None
    try:
        handle = win32api.OpenProcess(
            win32con.PROCESS_QUERY_INFORMATION | win32con.PROCESS_VM_READ, False, pid)
        exe = os.path.basename(win32process.GetModuleFileNameEx(handle, 0))
    except Exception:
        return ""
    finally:
        if handle:
            win32api.CloseHandle(handle)
    return _FRIENDLY_NAMES.get(exe.lower(), exe[:-4] if exe.lower().endswith(".exe") else exe)


def _shorten(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"
