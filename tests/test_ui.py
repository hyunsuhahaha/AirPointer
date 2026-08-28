from airpointer.main import App
from airpointer.cursor import CursorState
from airpointer.ui_snap import SnapResult
import numpy as np


def test_ui_fits_and_draws_pointer() -> None:
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
        state = CursorState(200, 200, 120, 130, False, SnapResult(200, 200, (180, 180, 220, 220)))
        app.overlay.draw(state)
        assert len(app.overlay.canvas.find_all()) >= 9
    finally:
        app._close()
