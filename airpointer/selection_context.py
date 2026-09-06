"""Reads what the user had selected right before a capture is taken, so the
AI receives the exact text instead of having to re-read it off a screenshot.
Called from main.App._begin_capture_prompt's freeze() thread, at the moment
the hotkey/gesture fires -- focus is still on whatever app the user was
actually using then; by the time the capture prompt window appears, focus
has already moved to AirPointer's own UI and this can no longer be read.

Two paths, tried in order:
1. UIA TextPattern.GetSelection() on the focused element -- read-only, no
   side effect, but only some apps implement it (confirmed working: modern
   Windows Notepad, which reports itself as a "Document" control).
2. A synthetic Ctrl+C fallback for everything else, gated by a safety check
   (skips Explorer -- there Ctrl+C copies files, not text -- and any
   control type that isn't a plain text control) since it's a real
   keystroke sent into whatever app currently has focus. The *entire*
   clipboard (every format present, not just text) is snapshotted before
   and restored after regardless of outcome, so a pre-existing copied file
   list or image is never silently dropped.

This is deliberately narrower than clipboard_tracker.py's rolling copy
history: that already covers "what did the user copy recently" (opt-in via
Settings.clipboard_history_enabled). This module answers a different
question -- "what's selected right now, even if never copied" -- so it
does not expose its own clipboard-content setting. The Ctrl+C fallback
above still goes through the *real* OS clipboard, though, so the caller
must bracket a call to get_selected_text() with
ClipboardTracker.suppress_delivery()/resume_after_delivery() (see
main.App._begin_capture_prompt) -- otherwise a running ClipboardTracker
would log this synthetic copy as if the user had copied it themselves.
"""
from __future__ import annotations

import contextlib
import ctypes
import os
import struct
import time

import comtypes.gen.UIAutomationClient as uia_client
import win32clipboard
from pywinauto.keyboard import send_keys
from pywinauto.uia_defines import IUIA
from pywinauto.uia_element_info import UIAElementInfo

from .desktop_paste import _process_name

_MAX_LENGTH = 4000
_TRUNCATED_SUFFIX = "…(생략)"

# Ctrl+C means "copy selected files" here, not text -- never send it.
_UNSAFE_PROCESSES = frozenset({"explorer.exe"})
# Confirmed empirically (modern Notepad reports "Document") plus the
# classic Win32 edit/combo control names -- anything else (List, Button,
# Custom, ...) risks a control-specific Ctrl+C binding unrelated to text.
_TEXT_CONTROL_TYPES = frozenset({"Edit", "Document", "Text", "ComboBox"})

# Korean nouns for the handful of control types worth naming in a one-line
# prompt hint (see element_label_at) -- an unlisted type (Pane, Group,
# Custom, ...) falls back to just the element's own name with no suffix
# rather than guessing a label for it.
_CONTROL_TYPE_LABELS = {
    "Button": "버튼", "MenuItem": "메뉴", "Hyperlink": "링크", "CheckBox": "체크박스",
    "ComboBox": "콤보박스", "TabItem": "탭", "ListItem": "항목", "Edit": "입력창",
    "RadioButton": "라디오 버튼", "Window": "창",
}
_LABEL_MAX_LENGTH = 30  # this feeds a one-line prompt hint, not a transcript

# SetWindowPos flags for the hide/show bracket in element_label_at:
# HIDEWINDOW/SHOWWINDOW toggle visibility only, the NO* flags keep this a
# pure visibility flip -- no move, resize, z-order change, or (critically)
# activation/focus theft from whatever app the user is actually in.
_SWP_NOSIZE, _SWP_NOMOVE, _SWP_NOZORDER, _SWP_NOACTIVATE = 0x0001, 0x0002, 0x0004, 0x0010
_SWP_HIDEWINDOW, _SWP_SHOWWINDOW = 0x0080, 0x0040
_SWP_VISIBILITY_ONLY = _SWP_NOSIZE | _SWP_NOMOVE | _SWP_NOZORDER | _SWP_NOACTIVATE
_GA_ROOT = 2  # GetAncestor flag: the real top-level window, see register_own_overlay_hwnd

_own_pid = os.getpid()
_iuia = IUIA()
# Set once by Overlay.__init__ (overlay.py) via register_own_overlay_hwnd --
# None until AirPointer's HUD overlay actually exists (e.g. this module
# imported standalone, as tests do).
_own_overlay_hwnd: int | None = None


def register_own_overlay_hwnd(hwnd: int) -> None:
    """Called once by Overlay.__init__ so element_label_at can briefly hide
    the click-through HUD overlay around its UI Automation point queries --
    see the comment there for why this is necessary (ElementFromPoint,
    unlike raw WindowFromPoint, does not see through this window's
    click-through styling on its own).

    `hwnd` is Overlay.window.winfo_id() -- but that is NOT the real
    top-level HWND Windows Z-orders against the desktop. Tk wraps an
    overrideredirect() Toplevel in an outer OS-level window that winfo_id()
    does not return (confirmed by hand: hiding winfo_id()'s own hwnd had
    ZERO effect on ElementFromPoint's hit test -- it kept resolving to a
    same-process window at the exact full-desktop rect regardless; hiding
    GetAncestor(hwnd, GA_ROOT) instead was the one that actually let
    ElementFromPoint see through to the real window underneath). Resolved
    and stored once here rather than on every query."""
    global _own_overlay_hwnd
    try:
        root_hwnd = ctypes.windll.user32.GetAncestor(hwnd, _GA_ROOT)
    except Exception:
        root_hwnd = 0
    _own_overlay_hwnd = root_hwnd or hwnd


def _set_own_overlay_visible(visible: bool) -> None:
    """Best-effort, never raises: a failure here must not block a capture,
    it just means callers fall back to hitting our own overlay (same as
    before this existed) and treat that as "nothing found" (see each
    caller's own _own_pid check)."""
    if _own_overlay_hwnd is None:
        return
    flags = (_SWP_SHOWWINDOW if visible else _SWP_HIDEWINDOW) | _SWP_VISIBILITY_ONLY
    try:
        ctypes.windll.user32.SetWindowPos(_own_overlay_hwnd, 0, 0, 0, 0, 0, flags)
    except Exception:
        pass


@contextlib.contextmanager
def own_overlay_hidden():
    """Hides AirPointer's own click-through HUD overlay (if registered) for
    the duration of the block, restoring it after -- for ANY caller
    (element_label_at below, click_tracker.py's _element_name_at) that
    needs a fresh, un-shadowed UI Automation POINT query. A no-op bracket
    if the overlay was never registered (_own_overlay_hwnd is None) --
    SetWindowPos on a stale/gone hwnd is itself a harmless best-effort
    no-op (see _set_own_overlay_visible).

    Only needed around point-based lookups (ElementFromPoint /
    UIAElementInfo.from_point) -- GetFocusedElement (get_selected_text)
    tracks keyboard focus, not Z-order, so the overlay (which never takes
    focus) can't shadow it and that one skips this bracket."""
    _set_own_overlay_visible(False)
    try:
        yield
    finally:
        _set_own_overlay_visible(True)


def get_selected_text() -> str:
    """Best-effort: returns "" on any failure rather than raising -- a
    capture must never be blocked by this."""
    try:
        element = _iuia.iuia.GetFocusedElement()
        info = UIAElementInfo(element)
        if info.process_id == _own_pid:
            return ""
    except Exception:
        return ""
    text = _via_text_pattern(element)
    if not text and _ctrlc_safe(info):
        text = _via_ctrlc_fallback()
    return _truncate(text) if text else ""


def element_label_at(x: int, y: int) -> str | None:
    """Best-effort: names whatever UI element sits at the given SCREEN pixel
    coordinate, e.g. "저장 버튼" -- used by screen_buffer.py to turn a
    detected-change bbox into a real control name instead of just a screen
    quadrant (see _bbox_element_label there). Coordinates are physical
    pixels: this process is per-monitor-DPI-aware (see
    airpointer_launcher._make_dpi_aware), so they already line up with
    mss's raw grab coordinates without further scaling.

    Returns None -- never raises -- on any failure, an element with no
    accessible name, or a point that resolves into AirPointer's own window
    (the capture overlay can itself be on screen during a replay); callers
    always have the quadrant label to fall back to, so this must never
    block a capture."""
    try:
        with own_overlay_hidden():
            info = UIAElementInfo.from_point(x, y)
        if info.process_id == _own_pid:
            return None
        name = (info.name or "").strip()
        if not name:
            return None
        control = _CONTROL_TYPE_LABELS.get(info.control_type, "")
    except Exception:
        return None
    label = f"{name} {control}".strip() if control else name
    return label if len(label) <= _LABEL_MAX_LENGTH else label[:_LABEL_MAX_LENGTH].rstrip() + "…"


def _read_clipboard_text() -> str:
    """Read-only peek at the current clipboard text -- used only to read
    back what the Ctrl+C fallback just copied. Never writes anything."""
    try:
        win32clipboard.OpenClipboard()
    except Exception:
        return ""
    try:
        try:
            text = win32clipboard.GetClipboardData(win32clipboard.CF_UNICODETEXT)
        except TypeError:
            text = ""
    finally:
        win32clipboard.CloseClipboard()
    return _truncate(text) if text else ""


def _via_text_pattern(element) -> str:
    try:
        pattern = element.GetCurrentPattern(uia_client.UIA_TextPatternId)
        if not pattern:
            return ""
        text_pattern = pattern.QueryInterface(uia_client.IUIAutomationTextPattern)
        selection = text_pattern.GetSelection()
        parts = [selection.GetElement(i).GetText(-1) for i in range(selection.Length)]
        return "\n".join(part for part in parts if part).strip()
    except Exception:
        return ""


def _ctrlc_safe(info: UIAElementInfo) -> bool:
    try:
        if info.control_type not in _TEXT_CONTROL_TYPES:
            return False
        return _process_name(info.process_id).lower() not in _UNSAFE_PROCESSES
    except Exception:
        return False


def _via_ctrlc_fallback(timeout: float = 0.3) -> str:
    try:
        before_seq = win32clipboard.GetClipboardSequenceNumber()
    except Exception:
        return ""
    snapshot = _snapshot_clipboard()
    try:
        try:
            send_keys("^c")
        except Exception:
            return ""
        if not _wait_for_clipboard_change(before_seq, timeout):
            return ""
        return _read_clipboard_text()
    finally:
        _restore_clipboard(snapshot)


def _wait_for_clipboard_change(before_seq: int, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if win32clipboard.GetClipboardSequenceNumber() != before_seq:
                return True
        except Exception:
            return False
        time.sleep(0.01)
    return False


def _snapshot_clipboard() -> list[tuple[int, object]]:
    """Every format currently on the clipboard, not just text -- a copied
    file list or image must come back exactly as it was, not get wiped by
    a fallback that only knew how to restore CF_UNICODETEXT."""
    entries: list[tuple[int, object]] = []
    try:
        win32clipboard.OpenClipboard()
    except Exception:
        return entries
    try:
        fmt = 0
        while True:
            fmt = win32clipboard.EnumClipboardFormats(fmt)
            if fmt == 0:
                break
            try:
                entries.append((fmt, win32clipboard.GetClipboardData(fmt)))
            except Exception:
                continue
    finally:
        win32clipboard.CloseClipboard()
    return entries


def _restore_clipboard(entries: list[tuple[int, object]]) -> None:
    try:
        win32clipboard.OpenClipboard()
    except Exception:
        return
    try:
        win32clipboard.EmptyClipboard()
        for fmt, data in entries:
            try:
                if fmt == win32clipboard.CF_HDROP:
                    data = _pack_hdrop(data)
                win32clipboard.SetClipboardData(fmt, data)
            except Exception:
                continue
    finally:
        win32clipboard.CloseClipboard()


def _pack_hdrop(paths) -> bytes:
    """GetClipboardData(CF_HDROP) hands back a plain tuple of paths (pywin32's
    own conversion on the read side), but SetClipboardData needs the raw
    DROPFILES struct back -- pywin32 doesn't round-trip this format
    symmetrically. Same packing as desktop_paste.set_clipboard_files."""
    file_list = "\0".join(paths) + "\0\0"
    file_list_bytes = file_list.encode("utf-16-le")
    dropfiles = struct.pack("<LLLLL", 20, 0, 0, 0, 1)
    return dropfiles + file_list_bytes


def _truncate(text: str) -> str:
    text = text.strip()
    if len(text) <= _MAX_LENGTH:
        return text
    return text[:_MAX_LENGTH].rstrip() + _TRUNCATED_SUFFIX
