from __future__ import annotations

import sys
import traceback


def _make_dpi_aware() -> None:
    """Must run before the first window is created (tk.Tk() in App.__init__)
    -- Windows locks in a process's DPI-awareness mode at that point, so
    setting it any later is a silent no-op. Without this, GetSystemMetrics'
    virtual-desktop coordinates (used to size/position the fullscreen overlay
    and its HUD) come back scaled inconsistently on mixed-DPI multi-monitor
    setups, landing the HUD on the wrong monitor."""
    if sys.platform != "win32":
        return
    import ctypes
    user32 = ctypes.windll.user32
    for context in (-4, -3):  # PER_MONITOR_AWARE_V2, then PER_MONITOR_AWARE
        try:
            if user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(context)):
                return
        except (AttributeError, OSError):
            pass
    try:
        user32.SetProcessDPIAware()  # Windows < 10 1703 fallback
    except (AttributeError, OSError):
        pass


_make_dpi_aware()


def main() -> int:
    from airpointer.main import App
    from airpointer.companion_bridge import CompanionHttpServer, CompanionState
    from airpointer.protocol import (CommandServer, command_from_arguments, register_protocol,
                                      send_command, token_from_arguments)

    register_protocol()
    command = command_from_arguments(sys.argv[1:])
    token = token_from_arguments(sys.argv[1:])
    if command and send_command(command, token=token):
        return 0
    if command is None and send_command("show"):
        return 0

    try:
        server = CommandServer()
    except OSError as error:
        if error.errno in {10048, 98}:
            if send_command(command or "show"):
                return 0
        raise

    state = CompanionState()
    bridge = CompanionHttpServer(state)
    bridge.start()
    app = App(start_hidden=command in {"start", "stop"}, companion_state=state)
    server.start(lambda next_command, next_token: app.root.after(
        0, app.handle_external_command, next_command, next_token))
    if command:
        app.root.after(0, app.handle_external_command, command, token)
    try:
        app.run()
    finally:
        bridge.close()
        server.close()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except BaseException:
        # AirPointer.exe has no console (pythonw), so an uncaught exception
        # anywhere before the Tk error handler is wired up (App.__init__,
        # the control-socket bind, protocol registration, ...) would
        # otherwise disappear silently and the app would just never show
        # up. Show it instead so a failed start is never invisible.
        detail = traceback.format_exc()
        try:
            import tkinter as tk
            from tkinter import messagebox
            root = tk.Tk()
            root.withdraw()
            messagebox.showerror("AirPointer가 시작되지 못했습니다", detail[-3000:])
        except Exception:
            pass
        raise
