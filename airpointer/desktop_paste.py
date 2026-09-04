"""Delivers captures to Codex Desktop via real OS clipboard/keyboard input
instead of any Codex protocol (RPC, IPC, or otherwise). AirPointer never
talks to Codex directly here -- it does exactly what a person at the
keyboard would do, so there is no writer lock to steal and nothing to
corrupt."""
from __future__ import annotations

import struct
import time
from pathlib import Path
from typing import Sequence

import win32api
import win32clipboard
import win32con
import win32gui
import win32process
from pywinauto import Desktop
from pywinauto.keyboard import send_keys

from .win32_focus import force_foreground

TARGET_PROCESSES = {"ChatGPT.exe", "Orca.exe"}
ATTACHMENT_NAME = "User attachment"


class DesktopPasteError(Exception):
    """Raised whenever the automation can't proceed safely. Never send
    keystrokes after this is raised -- the caller should stop, not retry
    blindly (a blind retry is how you end up typing into the wrong window)."""


def _process_name(pid: int) -> str:
    handle = win32api.OpenProcess(win32con.PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    try:
        return win32process.GetModuleFileNameEx(handle, 0).rsplit("\\", 1)[-1]
    finally:
        win32api.CloseHandle(handle)


def set_clipboard_files(paths: Sequence[Path]) -> None:
    """CF_HDROP is the same clipboard format Explorer uses for copied
    files. Chromium's paste handler exposes the whole list via
    clipboardData.files, so pasting this attaches every file in one
    Ctrl+V instead of needing one paste per image."""
    file_list = "\0".join(str(path) for path in paths) + "\0\0"
    file_list_bytes = file_list.encode("utf-16-le")
    dropfiles = struct.pack("<LLLLL", 20, 0, 0, 0, 1)  # pFiles offset, pt(0,0), fNC=0, fWide=1
    win32clipboard.OpenClipboard()
    try:
        win32clipboard.EmptyClipboard()
        win32clipboard.SetClipboardData(win32clipboard.CF_HDROP, dropfiles + file_list_bytes)
    finally:
        win32clipboard.CloseClipboard()


def set_clipboard_text(text: str) -> None:
    win32clipboard.OpenClipboard()
    try:
        win32clipboard.EmptyClipboard()
        win32clipboard.SetClipboardData(win32clipboard.CF_UNICODETEXT, text)
    finally:
        win32clipboard.CloseClipboard()


def find_codex_window_and_composer():
    """Returns (window, composer) for the first Codex Desktop window that
    actually has a locatable composer -- never just the first window whose
    process name matches, per the "never guess" review note."""
    desktop = Desktop(backend="uia")
    for window in desktop.windows():
        try:
            if _process_name(window.process_id()) not in TARGET_PROCESSES:
                continue
        except Exception:
            continue
        try:
            edits = window.descendants(control_type="Edit")
        except Exception:
            continue
        if edits:
            return window, edits[0]
    return None


def _sidebar_conversation_buttons(window):
    """Yields (title, button) for each sidebar conversation entry.
    Identified structurally -- immediately followed by "채팅 고정" then
    "채팅 보관" buttons -- rather than by screen position (the window can
    be anywhere) or by name alone (the main panel header repeats the
    active conversation's title as its own, separate button)."""
    try:
        buttons = window.descendants(control_type="Button")
    except Exception:
        return
    for index in range(len(buttons) - 2):
        try:
            if (buttons[index + 1].element_info.name == "채팅 고정"
                    and buttons[index + 2].element_info.name == "채팅 보관"):
                yield buttons[index].element_info.name, buttons[index]
        except Exception:
            continue


def list_conversations(window) -> list[str]:
    return [title for title, _ in _sidebar_conversation_buttons(window)]


def select_conversation(window, title: str) -> bool:
    """Clicks the sidebar entry matching `title` exactly, switching Codex
    Desktop's active conversation. Returns False and does nothing else if
    no exact match is found -- the caller falls back to whatever's
    already open rather than erroring out."""
    for candidate_title, button in _sidebar_conversation_buttons(window):
        if candidate_title == title:
            button.click_input()
            return True
    return False


def focus_window_and_composer(window, composer) -> None:
    target_hwnd = window.handle
    if win32gui.GetForegroundWindow() != target_hwnd:
        try:
            win32gui.SetForegroundWindow(target_hwnd)
        except Exception:
            pass
    if win32gui.GetForegroundWindow() != target_hwnd:
        try:
            force_foreground(target_hwnd)
        except Exception:
            pass
    try:
        composer.set_focus()
    except Exception:
        pass


def has_keyboard_focus(composer) -> bool:
    try:
        return bool(composer.element_info.element.CurrentHasKeyboardFocus)
    except Exception:
        return True  # can't confirm either way; caller still checked the foreground window


def verify_focus(window, composer) -> bool:
    return win32gui.GetForegroundWindow() == window.handle and has_keyboard_focus(composer)


def wait_for_focus(window, composer, timeout: float = 1.0) -> bool:
    """UIA's CurrentHasKeyboardFocus can lag slightly behind an actual
    focus change (observed: instantly False, then True ~200ms later on an
    identical call), so this is a short poll rather than a single check."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if verify_focus(window, composer):
            return True
        time.sleep(0.1)
    return False


def count_attachments(window) -> int:
    try:
        images = window.descendants(control_type="Image")
        return sum(1 for image in images if image.element_info.name == ATTACHMENT_NAME)
    except Exception:
        return -1


def wait_for_attachment_count(window, expected_count: int, timeout: float = 3.0) -> bool:
    """Polls the running count of "User attachment" images rather than just
    "does at least one exist" -- with more than one image pending, the
    latter would report success immediately on the very first paste and
    never actually confirm the later ones landed."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if count_attachments(window) >= expected_count:
            return True
        time.sleep(0.2)
    return False


def paste_images(window, composer, image_paths: Sequence[Path], timeout: float = 6.0) -> None:
    """Focuses the composer, verifies it, and pastes every image in a
    single Ctrl+V via CF_HDROP (a multi-file paste) instead of one paste
    per image -- much faster, and sidesteps Codex Desktop's known
    slowness with back-to-back individual image pastes
    (openai/codex#25997). Sends no keys at all if focus verification
    fails."""
    focus_window_and_composer(window, composer)
    if not wait_for_focus(window, composer):
        raise DesktopPasteError("포커스를 Codex 입력창에 맞추지 못했습니다.")
    before = count_attachments(window)
    set_clipboard_files(image_paths)
    send_keys("^v")
    if not wait_for_attachment_count(window, before + len(image_paths), timeout):
        raise DesktopPasteError(f"이미지 첨부 {len(image_paths)}장이 시간 내에 나타나지 않았습니다.")


def paste_prompt(window, composer, prompt: str) -> None:
    """Pastes the prompt text after an image is already attached. Text
    always travels via the clipboard, never pywinauto's key-by-key typing,
    since Korean input and literal {}/+/^/%/~/() characters are unreliable
    through send_keys()."""
    if not wait_for_focus(window, composer, timeout=0.5):
        raise DesktopPasteError("텍스트를 붙여넣기 전 포커스 확인에 실패했습니다.")
    set_clipboard_text(prompt)
    send_keys("^v")


def submit(window, composer) -> None:
    """Sends the actual Enter. Verifies focus one last time immediately
    before -- this is the one keystroke that can't be undone."""
    if not wait_for_focus(window, composer, timeout=0.5):
        raise DesktopPasteError("전송 직전 포커스 확인에 실패해 Enter를 보내지 않았습니다.")
    send_keys("{ENTER}")


def paste_capture_and_ask(image_paths: Sequence[Path], prompt: str,
                           conversation_title: str | None = None) -> None:
    """Full pipeline: find the window, focus it, optionally switch to a
    named conversation, paste the image(s) (one multi-file paste
    regardless of count), paste the prompt, submit, restore whatever
    window was focused before.

    conversation_title, when given, is looked up in the sidebar and
    clicked before pasting -- if no exact match is found, this silently
    falls back to sending to whatever conversation is already open,
    exactly like conversation_title=None, rather than raising. Note: the
    conversation Codex Desktop had open before the switch is *not*
    restored afterward (unlike the foreground window) -- only "which app
    has focus" is undone here, not "which conversation was selected"."""
    if not image_paths:
        raise DesktopPasteError("전송할 이미지가 없습니다.")
    previous_hwnd = win32gui.GetForegroundWindow()
    found = find_codex_window_and_composer()
    if not found:
        raise DesktopPasteError("Codex Desktop 창을 찾지 못했습니다.")
    window, composer = found
    try:
        if conversation_title and select_conversation(window, conversation_title):
            time.sleep(0.3)  # let the composer/content repaint after switching
            refreshed = find_codex_window_and_composer()
            if refreshed:
                window, composer = refreshed
        paste_images(window, composer, image_paths)
        paste_prompt(window, composer, prompt)
        submit(window, composer)
    finally:
        if previous_hwnd:
            try:
                win32gui.SetForegroundWindow(previous_hwnd)
            except Exception:
                pass
