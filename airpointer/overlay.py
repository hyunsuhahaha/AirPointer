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
        x, y = state.point_x, state.point_y
        r = 14
        self.canvas.create_oval(x - r, y - r, x + r, y + r, outline=color, width=3)
        self.canvas.create_oval(x - 4, y - 4, x + 4, y + 4, fill=color, outline=color)
        self.canvas.create_line(x - 22, y, x - 10, y, fill=color, width=2)
        self.canvas.create_line(x + 10, y, x + 22, y, fill=color, width=2)
        self.canvas.create_line(x, y - 22, x, y - 10, fill=color, width=2)
        self.canvas.create_line(x, y + 10, x, y + 22, fill=color, width=2)
        if state.snap:
            left, top, right, bottom = state.snap.rect
            self.canvas.create_line(x, y, state.x, state.y, fill="#44d7b6", width=2, dash=(4, 3))
            self.canvas.create_rectangle(left, top, right, bottom, outline="#44d7b6", width=3)
            self.canvas.create_oval(state.x - 5, state.y - 5, state.x + 5, state.y + 5,
                                    fill="#44d7b6", outline="#44d7b6")
