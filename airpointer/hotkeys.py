"""Global keyboard-shortcut triggers -- a camera-free alternative to the
hand-gesture path for the same three capture actions (see capture_controller.
CaptureController / main.App._dispatch_hotkey_action, which both hotkeys and
gestures ultimately call into).

Implementation note: RegisterHotKey(hwnd=None, ...) posts WM_HOTKEY straight
to the calling thread's message queue rather than to a window -- no WNDPROC
needed. But Win32 requires the thread that registers a hotkey to also be the
one pumping messages for it, so this runs its own small loop on a dedicated
thread instead of piggybacking on Tk's event loop (which never sees raw WM_*
messages). Verified end-to-end with a synthetic RegisterHotKey +
PeekMessage(..., PM_REMOVE) + keybd_event round trip before relying on it here."""
from __future__ import annotations

import threading
import time
from typing import Callable

import win32con
import win32gui

Bindings = dict[str, str]

MOD_NOREPEAT = 0x4000  # not in every win32con build; only fires once per physical press

_MODIFIER_FLAGS = {
    "ctrl": win32con.MOD_CONTROL, "control": win32con.MOD_CONTROL,
    "alt": win32con.MOD_ALT, "shift": win32con.MOD_SHIFT, "win": win32con.MOD_WIN,
}
_NAMED_KEYS = {
    "space": win32con.VK_SPACE, "esc": win32con.VK_ESCAPE, "escape": win32con.VK_ESCAPE,
    "tab": win32con.VK_TAB, "enter": win32con.VK_RETURN, "delete": win32con.VK_DELETE,
    "arrowup": win32con.VK_UP, "arrowdown": win32con.VK_DOWN,
    "arrowleft": win32con.VK_LEFT, "arrowright": win32con.VK_RIGHT,
    **{f"f{n}": getattr(win32con, f"VK_F{n}") for n in range(1, 13)},
}

# Same three actions capture_controller.CaptureKind covers, keyed the same
# way CompanionState's `gestures` dict already is -- kept in sync so a
# binding dict from either the native Settings file or the browser's
# companion config drops in without translation.
DEFAULT_BINDINGS: Bindings = {
    "screenshot": "ctrl+alt+s",
    "replay": "ctrl+alt+d",
    "region": "ctrl+alt+r",
}


def parse_binding(text: str) -> tuple[int, int] | None:
    """'ctrl+alt+s' -> (MOD_CONTROL|MOD_ALT, VK for 'S'), or None if the
    text isn't a modifier+key combo we can register. At least one modifier
    is required -- a bare key registered as a *global* hotkey would swallow
    that key everywhere, in every app, which is never what's wanted here."""
    parts = [part.strip().lower() for part in text.split("+") if part.strip()]
    if len(parts) < 2:
        return None
    *mods, key = parts
    modifiers = 0
    for mod in mods:
        flag = _MODIFIER_FLAGS.get(mod)
        if flag is None:
            return None
        modifiers |= flag
    if not modifiers:
        return None
    vk = ord(key.upper()) if len(key) == 1 and key.isalnum() else _NAMED_KEYS.get(key)
    if vk is None:
        return None
    return modifiers, vk


class HotkeyListener:
    """Owns zero or more registered global hotkeys and calls `on_trigger(action)`
    (from its own thread -- the caller is responsible for marshaling back to
    the UI thread, same as protocol.CommandServer's handler callback) when one
    fires. `bindings` is polled (not pushed) so the browser's companion config
    and the local Settings file can both feed it without either one needing
    a reference to this object."""

    def __init__(self, on_trigger: Callable[[str], None],
                 bindings: Callable[[], Bindings] | None = None,
                 poll_interval: float = 1.0) -> None:
        self._on_trigger = on_trigger
        self._bindings_source = bindings or (lambda: dict(DEFAULT_BINDINGS))
        self._poll_interval = poll_interval
        self._applied: Bindings = {}
        self._ids: dict[str, int] = {}
        self._conflicts: set[str] = set()
        self._conflicts_lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def conflicts(self) -> set[str]:
        """Actions whose combo is syntactically valid but RegisterHotKey
        rejected -- almost always ERROR_HOTKEY_ALREADY_REGISTERED, meaning
        some other running program already owns that exact combo globally.
        Read from other threads (the UI thread, for display), written only
        from this listener's own thread in _apply."""
        with self._conflicts_lock:
            return set(self._conflicts)

    def start(self) -> None:
        if self.running:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="airpointer-hotkeys", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread and self._thread is not threading.current_thread():
            self._thread.join(timeout=2.0)
        self._thread = None

    def _run(self) -> None:
        self._apply(self._bindings_source())
        try:
            next_poll = time.monotonic() + self._poll_interval
            while not self._stop.is_set():
                while True:
                    found, info = win32gui.PeekMessage(None, 0, 0, win32con.PM_REMOVE)
                    if not found:
                        break
                    _hwnd, message, wparam, _lparam, _time, _pt = info
                    if message == win32con.WM_HOTKEY:
                        self._handle(wparam)
                if time.monotonic() >= next_poll:
                    self._reapply_if_changed()
                    next_poll = time.monotonic() + self._poll_interval
                self._stop.wait(0.05)
        finally:
            self._apply({})

    def _handle(self, hotkey_id: int) -> None:
        action = next((name for name, value in self._ids.items() if value == hotkey_id), None)
        if action:
            self._on_trigger(action)

    def _reapply_if_changed(self) -> None:
        bindings = self._bindings_source()
        # Also retry on an unchanged binding set when something is still
        # conflicted -- the other app holding that combo may have exited
        # since the last attempt, and there's no OS notification for that,
        # only polling.
        if bindings != self._applied or self._conflicts:
            self._apply(bindings)

    def _apply(self, bindings: Bindings) -> None:
        for hotkey_id in self._ids.values():
            try:
                win32gui.UnregisterHotKey(None, hotkey_id)
            except Exception:
                pass
        self._ids = {}
        conflicts: set[str] = set()
        for index, (action, combo) in enumerate(bindings.items(), start=1):
            parsed = parse_binding(combo)
            if not parsed:
                continue
            modifiers, vk = parsed
            try:
                win32gui.RegisterHotKey(None, index, modifiers | MOD_NOREPEAT, vk)
            except Exception:
                # Almost always ERROR_HOTKEY_ALREADY_REGISTERED: some other
                # running program already owns this exact combo globally.
                # Previously swallowed silently, which was indistinguishable
                # from the shortcut simply not working -- now surfaced via
                # conflicts() so the UI (native hint label, browser recorder
                # card) can tell the user to pick a different key instead of
                # leaving them to wonder why nothing happens.
                conflicts.add(action)
                continue
            self._ids[action] = index
        self._applied = dict(bindings)
        with self._conflicts_lock:
            self._conflicts = conflicts
