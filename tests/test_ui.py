from airpointer.main import App
from airpointer.region_selection import SelectionView
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
