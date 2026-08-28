from airpointer.main import App


def test_start_button_fits_in_window() -> None:
    app = App()
    try:
        app.root.update()
        assert app.button.winfo_ismapped()
        button_bottom = app.button.winfo_rooty() + app.button.winfo_height()
        window_bottom = app.root.winfo_rooty() + app.root.winfo_height()
        assert button_bottom <= window_bottom
    finally:
        app._close()
