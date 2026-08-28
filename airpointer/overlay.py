from __future__ import annotations

import ctypes
import tkinter as tk

from .cursor import CursorState


class Overlay:
    def __init__(self, root: tk.Tk) -> None:
        self.window = tk.Toplevel(root)
        self.window.overrideredirect(True)
        self.window.attributes("-topmost", True)
        self.window.attributes("-transparentcolor", "#010101")
        width = self.window.winfo_screenwidth()
        height = self.window.winfo_screenheight()
        self.window.geometry(f"{width}x{height}+0+0")
        self.canvas = tk.Canvas(self.window, bg="#010101", highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)
        self.window.update_idletasks()
        hwnd = self.window.winfo_id()
        ex_style = ctypes.windll.user32.GetWindowLongW(hwnd, -20)
        ctypes.windll.user32.SetWindowLongW(hwnd, -20, ex_style | 0x20 | 0x08000000)

    def draw(self, state: CursorState | None) -> None:
        self.canvas.delete("all")
        if state is None:
            return
        color = "#ff9f1c" if state.pinching else "#44d7b6"
        r = 9
        self.canvas.create_oval(state.x - r, state.y - r, state.x + r, state.y + r,
                                outline=color, width=3)
        if state.snap:
            left, top, right, bottom = state.snap.rect
            self.canvas.create_rectangle(left, top, right, bottom, outline="#44d7b6", width=3)

