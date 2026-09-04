"""Shared Windows-foreground-focus helper.

Windows silently ignores a plain SetForegroundWindow call from a process
without "recent input" standing -- both AirPointer's own popups (raised
from a background camera-gesture callback, not a real click) and
desktop_paste.py's Codex Desktop automation need this to reliably grab OS
focus. Tk's own Toplevel.focus_force() hits the same restriction: it can
silently no-op, leaving focus_get() looking set internally while no
keystroke actually reaches the window."""
from __future__ import annotations

import win32api
import win32con
import win32gui
import win32process


def force_foreground(target_hwnd: int) -> None:
    """AttachThreadInput to the current foreground window (not the
    target) plus a synthetic Alt tap is the standard, widely-used way to
    satisfy Windows' "recently interactive" heuristic from a script."""
    current_thread = win32api.GetCurrentThreadId()
    foreground_hwnd = win32gui.GetForegroundWindow()
    foreground_thread, _ = win32process.GetWindowThreadProcessId(foreground_hwnd) if foreground_hwnd else (0, 0)
    attached = False
    if foreground_thread and foreground_thread != current_thread:
        attached = bool(win32process.AttachThreadInput(current_thread, foreground_thread, True))
    try:
        win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
        try:
            win32gui.ShowWindow(target_hwnd, win32con.SW_RESTORE)
            win32gui.SetForegroundWindow(target_hwnd)
        finally:
            win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
    finally:
        if attached:
            win32process.AttachThreadInput(current_thread, foreground_thread, False)
