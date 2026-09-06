import time
import tkinter as tk

from airpointer.main import App
from airpointer.region_selection import SelectionView
from airpointer.settings import Settings
import numpy as np
from pathlib import Path


def test_ui_fits_and_draws_pointer(tmp_path: Path) -> None:
    app = App()
    try:
        app.root.update()
        assert app.button.winfo_ismapped()
        button_bottom = app.button.winfo_rooty() + app.button.winfo_height()
        window_bottom = app.root.winfo_rooty() + app.root.winfo_height()
        assert button_bottom <= window_bottom
        app._set_frame(np.zeros((180, 320, 3), dtype=np.uint8))
        app._redraw()
        assert app.preview.winfo_ismapped() and app._preview_photo is not None
        app.overlay.clear()
        app.overlay.draw_selection(SelectionView("selecting", (80, 90, 320, 260)))
        assert len(app.overlay.canvas.find_all()) >= 4
        frozen = tmp_path / "frame.png"
        frozen.write_bytes(b"frozen")
        app._show_capture_prompt("replay", (frozen,), "")
        app.root.update()
        assert app._prompt_window is not None and app._prompt_window.winfo_viewable()
        assert app._prompt_text.winfo_viewable()
        app._cancel_capture_prompt()
        assert not frozen.exists()
    finally:
        app._close()


def test_clipboard_history_checkbox_gates_the_tracker_live(tmp_path: Path) -> None:
    app = App()
    try:
        assert app.settings.clipboard_history_enabled is False  # off by default
        assert not app.clipboard_tracker.running

        # Off while idle: setting flips, but nothing to start yet (tracking
        # isn't running) -- matches _set_replay_enabled's own guard.
        app._set_clipboard_history_enabled(True)
        assert app.settings.clipboard_history_enabled is True
        assert not app.clipboard_tracker.running

        # hotkey mode avoids touching a real webcam (see _start_tracking).
        app._start_tracking("hotkey")
        assert app.clipboard_tracker.running, "enabling before start must start the tracker with tracking"

        app._set_clipboard_history_enabled(False)
        assert not app.clipboard_tracker.running, "unchecking must stop the tracker immediately, not just next launch"

        app._set_clipboard_history_enabled(True)
        assert app.clipboard_tracker.running, "checking while already tracking must start it immediately"

        app._stop_tracking()
        assert not app.clipboard_tracker.running
    finally:
        # Leave this app instance's own setting back at the off default
        # before _close() persists it (App() always loads/saves the real
        # %LOCALAPPDATA%\AirPointer\settings.json, not a fixture path) --
        # otherwise this test would flip the user's actual saved setting to
        # "on" as a side effect of running the suite.
        app._set_clipboard_history_enabled(False)
        app._close()

    # Persistence itself (Settings.save()/load() round-tripping the field)
    # is exercised against a throwaway path, same as test_settings_round_trip
    # in test_agent_replay.py, rather than against the app's real settings
    # file -- both use Settings' generic field-name-driven load/save, so
    # this doesn't need App() at all to prove the field survives a
    # save/load cycle.
    settings_path = tmp_path / "settings.json"
    Settings(clipboard_history_enabled=True).save(settings_path)
    assert Settings.load(settings_path).clipboard_history_enabled is True


def _find_widget(root, widget_class):
    for child in root.winfo_children():
        if isinstance(child, widget_class):
            return child
        found = _find_widget(child, widget_class)
        if found is not None:
            return found
    return None


def test_capture_prompt_shows_a_clipboard_checkbox_that_shares_settings_state(tmp_path: Path) -> None:
    # This is the actual visible control the user sees every time they send
    # a capture (unlike the settings tab, which is out of view mid-capture)
    # -- see main.App._show_capture_prompt.
    app = App()
    try:
        assert app.settings.clipboard_history_enabled is False
        frozen = tmp_path / "frame.png"
        frozen.write_bytes(b"frozen")
        app._show_capture_prompt("screenshot", (frozen,), "")
        app.root.update()

        checkbox = _find_widget(app._prompt_window, tk.Checkbutton)
        assert checkbox is not None, "capture prompt must contain a Checkbutton"
        assert str(checkbox.cget("variable")) == str(app._clipboard_history_var), \
            "the prompt's checkbox must share the same BooleanVar as the settings tab's own"

        # Toggling the prompt's own checkbox (as a click would) must persist
        # exactly like the settings tab's checkbox does.
        app._clipboard_history_var.set(True)
        app._on_clipboard_checkbox_toggled()
        assert app.settings.clipboard_history_enabled is True

        app._cancel_capture_prompt()
    finally:
        app._set_clipboard_history_enabled(False)  # don't leave the real settings.json flipped on
        app._close()


def test_capture_prompt_frame_count_slider_is_replay_only_and_starts_collapsed(tmp_path: Path) -> None:
    # The slider is a per-send override of export_recent()'s frame_count --
    # meaningless for screenshot/region captures, which are always exactly
    # one image (see main.App._show_capture_prompt).
    app = App()
    try:
        # Each capture gets its own subfolder -- cleanup_paths() rmdir()s a
        # now-empty parent (see screen_buffer.cleanup_paths), and tmp_path
        # itself would become that parent if used directly for more than one
        # capture in the same test, deleting the fixture's own directory.
        (tmp_path / "a").mkdir()
        frozen = tmp_path / "a" / "frame.png"
        frozen.write_bytes(b"frozen")
        app._show_capture_prompt("screenshot", (frozen,), "")
        app.root.update()
        assert app._prompt_frame_count_var is None
        assert app._prompt_frame_count_panel is None
        app._cancel_capture_prompt()

        (tmp_path / "b").mkdir()
        replay_frame = tmp_path / "b" / "replay.png"
        replay_frame.write_bytes(b"frozen")
        app._show_capture_prompt("replay", (replay_frame,), "")
        app.root.update()
        assert app._prompt_frame_count_var is not None
        assert app._prompt_frame_count_var.get() == App._PROMPT_FRAME_COUNT_DEFAULT
        assert app._prompt_frame_count_panel is not None
        assert not app._prompt_frame_count_panel.winfo_ismapped(), \
            "starts collapsed, like a settings disclosure -- not open by default on this compact toast"
        app._cancel_capture_prompt()
    finally:
        app._close()


def test_capture_prompt_frame_count_toggle_expands_and_collapses(tmp_path: Path) -> None:
    app = App()
    try:
        frozen = tmp_path / "frame.png"
        frozen.write_bytes(b"frozen")
        app._show_capture_prompt("replay", (frozen,), "")
        app.root.update()

        app._toggle_prompt_frame_count_panel()
        app.root.update()  # winfo_ismapped() only reflects pack()/pack_forget() after Tk processes it
        assert app._prompt_frame_count_panel.winfo_ismapped()
        assert app._prompt_frame_count_toggle_var.get().startswith("▾")

        app._toggle_prompt_frame_count_panel()
        app.root.update()
        assert not app._prompt_frame_count_panel.winfo_ismapped()
        assert app._prompt_frame_count_toggle_var.get().startswith("▸")

        app._cancel_capture_prompt()
    finally:
        app._close()


def test_capture_prompt_submit_skips_reextraction_when_slider_matches_current_paths(tmp_path: Path) -> None:
    app = App()
    try:
        frozen = tmp_path / "frame.png"
        frozen.write_bytes(b"frozen")
        app._show_capture_prompt("replay", (frozen,), "")
        app.root.update()
        app._prompt_text.insert("1.0", "질문")
        # One path already captured, slider left at its default (6) -- the
        # mismatch check only ever compares against len(current paths), not
        # against the default, so set the slider to 1 to match.
        app._prompt_frame_count_var.set(1)

        export_calls: list[int] = []
        app.screen_buffer.export_recent = lambda *a, **k: export_calls.append(k.get("frame_count")) or ()  # noqa: E731
        sent: list[tuple] = []
        app.capture.send_prepared = lambda *a, **k: sent.append(a) or True  # noqa: E731

        app._submit_capture_prompt()

        assert export_calls == [], "count already matches len(paths) -- must not re-extract at all"
        assert sent and sent[0][2] == (frozen,)
    finally:
        app._close()


def test_capture_prompt_submit_reextracts_when_slider_differs_and_cleans_up_old_paths(tmp_path: Path) -> None:
    app = App()
    try:
        old_frame = tmp_path / "old.png"
        old_frame.write_bytes(b"frozen")
        app._show_capture_prompt("replay", (old_frame,), "")
        app.root.update()
        app._prompt_text.insert("1.0", "질문")
        app._prompt_frame_count_var.set(3)  # differs from the 1 path already captured

        new_frame = tmp_path / "new.png"
        new_frame.write_bytes(b"fresh")
        export_calls: list[int] = []

        def fake_export_recent(_seconds, frame_count=6, with_manifest=False):
            export_calls.append(frame_count)
            time.sleep(0.2)  # long enough that a second submit reliably lands mid-flight, below
            return (new_frame,)
        app.screen_buffer.export_recent = fake_export_recent
        sent: list[tuple] = []
        app.capture.send_prepared = lambda *a, **k: sent.append(a) or True  # noqa: E731
        # The real .after(0, ...) requires an actual Tk mainloop running to
        # safely schedule a callback FROM a background thread -- this test
        # drives the event queue with bare update() calls instead (no real
        # mainloop), which _show_capture_prompt's own pre-existing
        # _load_prompt_agents background thread already can't do reliably
        # either. Running the callback inline keeps this test about the
        # actual new logic (recount decision, cleanup, double-submit guard)
        # rather than about Tk's threading model, which nothing here changed.
        app.root.after = lambda _delay, func, *a: func(*a)  # type: ignore[method-assign]

        app._submit_capture_prompt()
        assert app._prompt_recounting is True, "must guard against a second Enter firing a duplicate re-extract"
        # A second Enter/submit landing while the first is still re-extracting
        # (the 0.2s sleep above keeps this window open) must be a no-op, not
        # a second overlapping export_recent() call.
        app._submit_capture_prompt()

        deadline = time.time() + 5
        while app._prompt_recounting and time.time() < deadline:
            time.sleep(0.02)

        assert export_calls == [3], "must re-extract exactly once, ignoring the overlapping second submit"
        assert not old_frame.exists(), "the pre-slider-change frame must be cleaned up, not leaked"
        assert sent and sent[0][2] == (new_frame,), "must send the newly re-extracted frame, not the stale one"
        assert app._prompt_recounting is False
    finally:
        app._close()


def test_screenshot_capture_also_opens_prompt(tmp_path: Path) -> None:
    # Screenshot used to send instantly with a default question (mirroring
    # the palm->fist gesture); the prompt window is now shared across every
    # capture kind (see main.App._begin_capture_prompt), so a screenshot
    # dispatch should show the same prompt UI replay already did, just
    # labeled for the kind that triggered it.
    app = App()
    try:
        frozen = tmp_path / "frame.png"
        frozen.write_bytes(b"frozen")
        app._show_capture_prompt("screenshot", (frozen,), "")
        app.root.update()
        assert app._prompt_window is not None and app._prompt_window.winfo_viewable()
        assert app._prompt_header_var.get() == "SCREEN CAPTURED"
        app._cancel_capture_prompt()
        assert not frozen.exists()
    finally:
        app._close()
