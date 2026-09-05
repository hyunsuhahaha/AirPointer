"""Delivers captures to a chat desktop app (Codex Desktop or Claude
Desktop) via real OS clipboard/keyboard input instead of any app-specific
protocol (RPC, IPC, or otherwise). AirPointer never talks to the app
directly here -- it does exactly what a person at the keyboard would do,
so there is no writer lock to steal and nothing to corrupt."""
from __future__ import annotations

import struct
import time
from pathlib import Path
from typing import NamedTuple, Sequence

import win32api
import win32clipboard
import win32con
import win32gui
import win32process
from pywinauto import Desktop
from pywinauto.keyboard import send_keys

from .win32_focus import force_foreground


class AppTarget(NamedTuple):
    """One desktop app DesktopPasteDelivery can drive: `processes` is how
    its top-level window is located (see find_codex_window_and_composer),
    `label` is used only in status/error text shown to the user."""
    label: str
    processes: frozenset[str]


# Codex Desktop ships under two different process names depending on
# build/branding (ChatGPT.exe historically, Orca.exe in some builds) --
# both are checked so either is found regardless of which one is running.
CODEX = AppTarget("Codex Desktop", frozenset({"ChatGPT.exe", "Orca.exe"}))
CLAUDE = AppTarget("Claude Desktop", frozenset({"claude.exe"}))

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



# Keyed by AppTarget so switching the delivery target mid-session (e.g. the
# user flips the "Send to" setting from Codex to Claude without restarting
# AirPointer) can't return a stale window cached for the *other* target --
# each target's cache entry is independent and checked on its own.
_cache: dict[AppTarget, tuple[int, object, object]] = {}  # target -> (hwnd, window, composer)


def _composer_alive(composer) -> bool:
    """Cheap, read-only liveness check for a cached composer element --
    a destroyed UIA element raises on property access instead of just
    returning a stale value."""
    try:
        composer.element_info.control_type
        return True
    except Exception:
        return False


def _find_composer_in_window(window):
    """Re-locates the composer Edit control inside an already-known window
    (e.g. after switching conversations) without re-enumerating every
    top-level window on the desktop."""
    try:
        edits = window.descendants(control_type="Edit")
    except Exception:
        return None
    return edits[0] if edits else None


def find_codex_window_and_composer(app: AppTarget, use_cache: bool = True):
    """Returns (window, composer) for the first `app` window that actually
    has a locatable composer -- never just the first window whose process
    name matches, per the "never guess" review note.

    Electron/Chromium apps build their UI Automation tree lazily, so the
    first-ever query against a given window can take upward of 20-30s
    (measured, both for Codex Desktop and Claude Desktop); a full
    `Desktop(backend="uia").windows()` scan even once warm still costs a
    few hundred ms. Both are avoided on a cache hit -- see `warmup()` in
    codex_delivery.py for hiding the first cost before the user ever sends
    anything, and `_composer_alive` for why a cache hit is safe to trust
    without re-scanning."""
    if use_cache and app in _cache:
        hwnd, cached_window, cached_composer = _cache[app]
        if win32gui.IsWindow(hwnd) and _composer_alive(cached_composer):
            return cached_window, cached_composer
        del _cache[app]
    desktop = Desktop(backend="uia")
    for window in desktop.windows():
        try:
            if _process_name(window.process_id()) not in app.processes:
                continue
        except Exception:
            continue
        composer = _find_composer_in_window(window)
        if composer is not None:
            _cache[app] = (window.handle, window, composer)
            return window, composer
    return None


def _sidebar_conversation_buttons(window):
    """Yields (title, button) for each sidebar conversation entry, pinned
    or not. Identified structurally -- immediately followed by a "채팅 고정"
    button -- rather than by screen position (the window can be anywhere)
    or by name alone (the main panel header repeats the active
    conversation's title as its own, separate button). Only "채팅 고정" is
    required, not also "채팅 보관" after it: already-pinned rows and
    workspace-linked tasks (see _project_groups) don't get an archive
    button, so requiring both used to silently skip them."""
    try:
        buttons = window.descendants(control_type="Button")
    except Exception:
        return
    for index in range(len(buttons) - 1):
        try:
            if buttons[index + 1].element_info.name == "채팅 고정":
                yield buttons[index].element_info.name, buttons[index]
        except Exception:
            continue


def list_conversations(window) -> list[str]:
    return [title for title, _ in _sidebar_conversation_buttons(window)]


_CLAUDE_OPTIONS_SUFFIX = "에 대한 더 많은 옵션"
_CLAUDE_NEW_SESSION_SUFFIX = " 새 세션"
_CLAUDE_MISC_BUCKET = "기타"


def _claude_sidebar_rows(window):
    """Yields (project, title, button) for each sidebar session row in
    Claude Desktop, in sidebar order. Claude Desktop has no named
    Group-per-project the way Codex Desktop does (see _project_groups) --
    every Group/List here comes back unnamed -- so this instead walks the
    flat, ordered button list with a little state, same "identify by an
    adjacent structural marker" idea as _sidebar_conversation_buttons:
    - A project header is `name` immediately followed by a
      "{name} 새 세션" button.
    - A session row is `<status prefix> title` immediately followed by a
      "{title}에 대한 더 많은 옵션" button -- the title is recovered by
      stripping that fixed suffix off the second button's own name, which
      sidesteps needing to enumerate every localized status word ("유휴",
      "실행 중", "오류", "읽지 않은 응답", ...; new ones can appear without
      breaking this).
    - "기타" marks the start of the ungrouped/pinned bucket, same role as
      Codex's "" project.
    The main panel's own header (which repeats the active conversation's
    title, see _sidebar_conversation_buttons's docstring) is naturally
    excluded: it's a lone rename button, never followed by a matching
    "...에 대한 더 많은 옵션" sibling."""
    try:
        buttons = window.descendants(control_type="Button")
    except Exception:
        return
    project = ""
    for index in range(len(buttons) - 1):
        try:
            name = buttons[index].element_info.name
            next_name = buttons[index + 1].element_info.name
        except Exception:
            continue
        if name == _CLAUDE_MISC_BUCKET:
            project = ""
        elif next_name == f"{name}{_CLAUDE_NEW_SESSION_SUFFIX}":
            project = name
        elif next_name.endswith(_CLAUDE_OPTIONS_SUFFIX):
            title = next_name[: -len(_CLAUDE_OPTIONS_SUFFIX)]
            if name == title or name.endswith(f" {title}"):
                yield project, title, buttons[index]


_LOAD_MORE = "더 보기"


def _project_groups(window):
    """Yields (project_name, [conversation titles]) for each project or
    CLI-connected workspace section in the sidebar, in sidebar order.
    Identified structurally: Codex Desktop wraps each one in a Group whose
    name is the project/workspace name, containing a List named
    "<name>에 있는 예약된 작업" that holds its conversations -- the same
    pattern for a cloud "프로젝트" and a "코드 kali-vm"-style workspace, so
    no need to special-case which section of the sidebar it's under."""
    try:
        groups = window.descendants(control_type="Group")
    except Exception:
        return
    for group in groups:
        try:
            name = group.element_info.name
            if not name:
                continue
            target = f"{name}에 있는 예약된 작업"
            lists = group.descendants(control_type="List")
            matching = next((lst for lst in lists if lst.element_info.name == target), None)
            if matching is None:
                continue
            titles = [item.element_info.name for item in matching.descendants(control_type="ListItem")
                     if item.element_info.name and item.element_info.name != _LOAD_MORE]
        except Exception:
            continue
        if titles:
            yield name, titles


def list_conversations_by_project(window, app: AppTarget) -> list[tuple[str, list[str]]]:
    """Groups the sidebar's conversations the way the target app's own UI
    does: one bucket per project/workspace (in sidebar order), plus a ""
    bucket for pinned/recent conversations that aren't inside any project."""
    if app is CLAUDE:
        grouped: list[tuple[str, list[str]]] = []
        for project, title, _button in _claude_sidebar_rows(window):
            if grouped and grouped[-1][0] == project:
                grouped[-1][1].append(title)
            else:
                grouped.append((project, [title]))
        return grouped
    grouped = list(_project_groups(window))
    grouped_titles = {title for _, titles in grouped for title in titles}
    ungrouped = [title for title in list_conversations(window) if title not in grouped_titles]
    return grouped + ([("", ungrouped)] if ungrouped else [])


def select_conversation(window, app: AppTarget, title: str) -> bool:
    """Clicks the sidebar entry matching `title` exactly, switching the
    target app's active conversation. Returns False and does nothing else
    if no exact match is found -- the caller falls back to whatever's
    already open rather than erroring out."""
    rows = (((row_title, button) for _project, row_title, button in _claude_sidebar_rows(window))
            if app is CLAUDE else _sidebar_conversation_buttons(window))
    for candidate_title, button in rows:
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
        time.sleep(0.05)
    return False


def acquire_focus(window, composer, attempts: int = 3) -> bool:
    """Retries the whole focus_window_and_composer + wait_for_focus sequence
    rather than accepting a single attempt's outcome: force_foreground's
    AttachThreadInput + synthetic-Alt trick (see win32_focus.py) is the
    standard way to satisfy Windows' "recently interactive" requirement for
    SetForegroundWindow from a background process, but it's still a race
    against whatever currently owns the foreground (observed failing when
    triggered by a global hotkey while a browser tab had focus) -- losing
    that race once isn't the same as it being unwinnable, so this gives it
    a few more tries with a short pause before actually giving up."""
    for attempt in range(attempts):
        focus_window_and_composer(window, composer)
        if wait_for_focus(window, composer):
            return True
        if attempt < attempts - 1:
            time.sleep(0.2)
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
        time.sleep(0.05)
    return False


def paste_images(window, composer, image_paths: Sequence[Path], app: AppTarget = CODEX,
                  timeout: float = 6.0) -> None:
    """Focuses the composer, verifies it, and pastes every image in a
    single Ctrl+V via CF_HDROP (a multi-file paste) instead of one paste
    per image -- much faster, and sidesteps Codex Desktop's known
    slowness with back-to-back individual image pastes
    (openai/codex#25997). Sends no keys at all if focus verification
    fails.

    Positive confirmation (polling count_attachments for the "User
    attachment" UIA label) only works for Codex -- confirmed empirically
    that Claude Desktop's own attached-image thumbnail isn't exposed as a
    UIA Image with any comparable name (none of ~46 Image elements in a
    composer with a real attachment matched anything attachment-like), so
    polling for it there would just always time out and abort the send
    right after a paste that actually worked, before paste_prompt/submit()
    ever ran. A short fixed settle delay stands in for that target instead
    -- the clipboard paste itself is a generic OS mechanism, not something
    that depends on the target app being able to confirm it happened."""
    if not acquire_focus(window, composer):
        raise DesktopPasteError(f"포커스를 {app.label} 입력창에 맞추지 못했습니다.")
    before = count_attachments(window)
    set_clipboard_files(image_paths)
    send_keys("^v")
    if app is CODEX:
        if not wait_for_attachment_count(window, before + len(image_paths), timeout):
            raise DesktopPasteError(f"이미지 첨부 {len(image_paths)}장이 시간 내에 나타나지 않았습니다.")
    else:
        time.sleep(0.6)


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


def paste_capture_and_ask(app: AppTarget, image_paths: Sequence[Path], prompt: str,
                           conversation_title: str | None = None) -> None:
    """Full pipeline: find the `app` window, focus it, optionally switch to
    a named conversation, paste the image(s) (one multi-file paste
    regardless of count), paste the prompt, submit, restore whatever
    window was focused before.

    conversation_title, when given, is looked up in the sidebar and
    clicked before pasting -- if no exact match is found, this silently
    falls back to sending to whatever conversation is already open,
    exactly like conversation_title=None, rather than raising. Note: the
    conversation the app had open before the switch is *not* restored
    afterward (unlike the foreground window) -- only "which app has focus"
    is undone here, not "which conversation was selected"."""
    if not image_paths:
        raise DesktopPasteError("전송할 이미지가 없습니다.")
    previous_hwnd = win32gui.GetForegroundWindow()
    found = find_codex_window_and_composer(app)
    if not found:
        raise DesktopPasteError(f"{app.label} 창을 찾지 못했습니다.")
    window, composer = found
    try:
        if conversation_title and select_conversation(window, app, conversation_title):
            time.sleep(0.3)  # let the composer/content repaint after switching
            # Re-locate the composer within the same window instead of
            # re-scanning the whole desktop -- the window itself didn't
            # change, only its content did.
            refreshed_composer = _find_composer_in_window(window)
            if refreshed_composer is not None:
                composer = refreshed_composer
                _cache[app] = (window.handle, window, composer)
            else:
                refreshed = find_codex_window_and_composer(app, use_cache=False)
                if refreshed:
                    window, composer = refreshed
        paste_images(window, composer, image_paths, app)
        paste_prompt(window, composer, prompt)
        submit(window, composer)
    finally:
        if previous_hwnd:
            try:
                win32gui.SetForegroundWindow(previous_hwnd)
            except Exception:
                pass
