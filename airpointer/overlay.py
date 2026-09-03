from __future__ import annotations

import ctypes
import math
import time
import tkinter as tk
from collections import deque

from .cursor import CursorState
from .region_selection import SelectionView

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
        # Cover the Windows virtual desktop rather than only Tk's primary monitor.
        # This is the same coordinate space used by native screen-capture tools.
        user32 = ctypes.windll.user32
        try:
            user32.SetProcessDPIAware()
        except (AttributeError, OSError):
            pass
        self.origin_x = user32.GetSystemMetrics(76)  # SM_XVIRTUALSCREEN
        self.origin_y = user32.GetSystemMetrics(77)  # SM_YVIRTUALSCREEN
        width = user32.GetSystemMetrics(78)          # SM_CXVIRTUALSCREEN
        height = user32.GetSystemMetrics(79)         # SM_CYVIRTUALSCREEN
        if width <= 0 or height <= 0:
            self.origin_x = self.origin_y = 0
            width, height = self.window.winfo_screenwidth(), self.window.winfo_screenheight()
        self.width, self.height = width, height
        x_offset = f"+{self.origin_x}" if self.origin_x >= 0 else str(self.origin_x)
        y_offset = f"+{self.origin_y}" if self.origin_y >= 0 else str(self.origin_y)
        self.window.geometry(f"{width}x{height}{x_offset}{y_offset}")
        self.canvas = tk.Canvas(self.window, bg="#010101", highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)
        self._trail: deque[tuple[int, int]] = deque(maxlen=8)
        self.window.update_idletasks()
        hwnd = self.window.winfo_id()
        ex_style = user32.GetWindowLongW(hwnd, -20)
        user32.SetWindowLongW(hwnd, -20, ex_style | 0x20 | 0x08000000)
        try:
            # Keep the HUD and crop mask out of screenshots on supported Windows versions.
            user32.SetWindowDisplayAffinity(hwnd, 0x11)
        except (AttributeError, OSError):
            pass

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

    def draw_selection(self, view: SelectionView) -> None:
        if not view.active:
            return
        shade = "#07131c"
        if view.rect is None:
            self.canvas.create_rectangle(0, 0, self.width, self.height, fill=shade,
                                         stipple="gray50", outline="")
            self.canvas.create_text(self.width // 2, self.height // 2 - 18,
                                    text="AREA CAPTURE", fill="#44e5ff",
                                    font=("Consolas", 18, "bold"))
            self.canvas.create_text(self.width // 2, self.height // 2 + 18,
                                    text="POINT WITH YOUR INDEX FINGER",
                                    fill="#bdeeff", font=("Consolas", 10, "bold"))
            return

        left, top, right, bottom = view.rect
        left -= self.origin_x
        right -= self.origin_x
        top -= self.origin_y
        bottom -= self.origin_y
        for coords in ((0, 0, self.width, top), (0, bottom, self.width, self.height),
                       (0, top, left, bottom), (right, top, self.width, bottom)):
            self.canvas.create_rectangle(*coords, fill=shade, stipple="gray50", outline="")
        color = "#fff07a" if view.phase in ("confirming", "cooldown") else "#44e5ff"
        self.canvas.create_rectangle(left, top, right, bottom, outline=color, width=2)
        corner = min(24, max(10, (right - left) // 5), max(10, (bottom - top) // 5))
        for segment in ((left, top + corner, left, top, left + corner, top),
                        (right - corner, top, right, top, right, top + corner),
                        (right, bottom - corner, right, bottom, right - corner, bottom),
                        (left + corner, bottom, left, bottom, left, bottom - corner)):
            self.canvas.create_line(*segment, fill=color, width=5)
        label_x = min(max(left, 8), max(8, self.width - 150))
        label_y = top - 25 if top >= 34 else min(self.height - 24, bottom + 25)
        self.canvas.create_text(label_x, label_y,
                                text=f"{right - left} × {bottom - top}  •  FIST TO CAPTURE",
                                fill=color, font=("Consolas", 10, "bold"), anchor="w")
        if view.pointer:
            x, y = view.pointer
            x -= self.origin_x
            y -= self.origin_y
            self.canvas.create_line(x - 18, y, x + 18, y, fill=color, width=2)
            self.canvas.create_line(x, y - 18, x, y + 18, fill=color, width=2)
            if view.phase == "confirming":
                radius = 25
                self.canvas.create_arc(x - radius, y - radius, x + radius, y + radius,
                                       start=90, extent=-max(4, round(360 * view.progress)),
                                       outline="#fff07a", width=5)

    def draw_command(self, command, delivery, buffer) -> None:
        if buffer.running:
            seconds = int(buffer.seconds)
            self.canvas.create_text(self.width - 24, 22,
                                    text=f"● BUFFER {seconds // 60:02d}:{seconds % 60:02d}",
                                    fill="#74f7c5", font=("Consolas", 9, "bold"), anchor="e")
        if command.phase in ("arming", "armed") and command.route == "replay":
            x, y, radius = self.width - 68, 82, 38
            progress = command.progress
            self.canvas.create_oval(x - radius, y - radius, x + radius, y + radius,
                                    outline="#d7e4ea", width=5)
            extent = max(10, round(360 * progress))
            self.canvas.create_arc(x - radius, y - radius, x + radius, y + radius,
                                   start=90, extent=-extent, outline="#ff6b22", width=8)
            self.canvas.create_text(x, y - 3, text=f"{progress * 2:.1f}",
                                    fill="#ffffff", font=("Consolas", 16, "bold"))
            self.canvas.create_text(x, y + 17, text="PALM · 2 SEC", fill="#ff8a50",
                                    font=("Consolas", 7, "bold"))
        if delivery.mode not in ("READY",):
            color = "#ff6767" if "FAILED" in delivery.mode or "ERROR" in delivery.mode else "#44e5ff"
            self.canvas.create_text(self.width - 24, 44, text=delivery.mode, fill=color,
                                    font=("Consolas", 9, "bold"), anchor="e")
