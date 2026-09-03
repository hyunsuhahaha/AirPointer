from __future__ import annotations

import ctypes
import math
import time
import tkinter as tk
from collections import deque

from .cursor import CursorState
from .gaze import CalibrationView

COLORS = {
    "tracking": "#44e5ff",
    "hover": "#74f7c5",
    "pinch": "#ffb02e",
    "click": "#fff07a",
    "drag": "#ff67d4",
    "lost": "#4d7180",
}


class Overlay:
    def __init__(self, root: tk.Tk) -> None:
        self.window = tk.Toplevel(root)
        self.window.overrideredirect(True)
        self.window.attributes("-topmost", True)
        self.window.attributes("-transparentcolor", "#010101")
        width, height = self.window.winfo_screenwidth(), self.window.winfo_screenheight()
        self.width, self.height = width, height
        self.window.geometry(f"{width}x{height}+0+0")
        self.canvas = tk.Canvas(self.window, bg="#010101", highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)
        self._trail: deque[tuple[int, int]] = deque(maxlen=8)
        self.window.update_idletasks()
        hwnd = self.window.winfo_id()
        ex_style = ctypes.windll.user32.GetWindowLongW(hwnd, -20)
        ctypes.windll.user32.SetWindowLongW(hwnd, -20, ex_style | 0x20 | 0x08000000)

    def draw(self, state: CursorState | None) -> None:
        self.canvas.delete("all")
        if state is None:
            self._trail.clear()
            return

        x, y = state.point_x, state.point_y
        mode = state.mode
        color = COLORS.get(mode, COLORS["tracking"])
        if mode != "lost" and (not self._trail or math.hypot(x - self._trail[-1][0], y - self._trail[-1][1]) > 2):
            self._trail.append((x, y))
        self._draw_trail(color)

        pulse = (math.sin(time.monotonic() * 8) + 1) / 2
        radius = 10 if mode in ("pinch", "click") else 15 + round(pulse * 2)
        self.canvas.create_arc(x - radius, y - radius, x + radius, y + radius,
                               start=15, extent=105, outline=color, width=3)
        self.canvas.create_arc(x - radius, y - radius, x + radius, y + radius,
                               start=195, extent=105, outline=color, width=3)
        self.canvas.create_oval(x - 3, y - 3, x + 3, y + 3, fill=color, outline=color)
        arm = radius + 9
        for x1, y1, x2, y2 in ((x - arm, y, x - radius - 3, y), (x + radius + 3, y, x + arm, y),
                               (x, y - arm, x, y - radius - 3), (x, y + radius + 3, x, y + arm)):
            self.canvas.create_line(x1, y1, x2, y2, fill=color, width=2)
        self.canvas.create_text(x + 25, y - 24, text=mode.upper(), fill=color,
                                font=("Consolas", 9, "bold"), anchor="w")

        if state.snap:
            self._draw_target(state, color, solid=mode in ("pinch", "drag", "click"))

    def _draw_trail(self, color: str) -> None:
        points = list(self._trail)
        if len(points) < 2:
            return
        for index in range(1, len(points)):
            width = 1 if index < len(points) - 3 else 2
            self.canvas.create_line(*points[index - 1], *points[index], fill=color, width=width)

    def _draw_target(self, state: CursorState, color: str, solid: bool) -> None:
        left, top, right, bottom = state.snap.rect
        length = min(18, max(7, (right - left) // 4), max(7, (bottom - top) // 4))
        segments = (
            (left, top + length, left, top, left + length, top),
            (right - length, top, right, top, right, top + length),
            (right, bottom - length, right, bottom, right - length, bottom),
            (left + length, bottom, left, bottom, left, bottom - length),
        )
        for segment in segments:
            self.canvas.create_line(*segment, fill=color, width=3)
        self.canvas.create_line(state.point_x, state.point_y, state.x, state.y, fill=color,
                                width=2, dash=() if solid else (5, 4))
        self.canvas.create_oval(state.x - 4, state.y - 4, state.x + 4, state.y + 4,
                                fill=color, outline=color)

    def draw_gaze(self, gaze: tuple[float, float] | None) -> None:
        if gaze is None:
            return
        x, y = round(gaze[0] * self.width), round(gaze[1] * self.height)
        color = "#b8ff5a"
        self.canvas.create_oval(x - 19, y - 19, x + 19, y + 19, outline=color, width=2)
        self.canvas.create_oval(x - 4, y - 4, x + 4, y + 4, fill=color, outline=color)
        self.canvas.create_text(x + 25, y - 20, text="GAZE", fill=color,
                                font=("Consolas", 9, "bold"), anchor="w")

    def draw_calibration(self, view: CalibrationView) -> None:
        if view.target is None:
            return
        x, y = round(view.target[0] * self.width), round(view.target[1] * self.height)
        color = "#ffb02e" if view.progress < 0.4 else "#b8ff5a"
        radius = 32 - round(view.progress * 18)
        self.canvas.create_oval(x - radius, y - radius, x + radius, y + radius,
                                outline=color, width=4)
        self.canvas.create_oval(x - 5, y - 5, x + 5, y + 5, fill=color, outline=color)
        self.canvas.create_text(x, y + 48, text=f"LOOK HERE  {view.index + 1}/{view.total}",
                                fill=color, font=("Consolas", 12, "bold"))
