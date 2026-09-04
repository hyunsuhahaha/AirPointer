from __future__ import annotations

import ctypes
import tkinter as tk

from .region_selection import SelectionView


class Overlay:
    def __init__(self, root: tk.Tk) -> None:
        self.window = tk.Toplevel(root)
        self.window.overrideredirect(True)
        self.window.attributes("-topmost", True)
        self.window.attributes("-transparentcolor", "#010101")
        # Cover the Windows virtual desktop rather than only Tk's primary monitor.
        # This is the same coordinate space used by native screen-capture tools.
        # DPI awareness itself is set in airpointer_launcher.main(), before
        # tk.Tk() creates the first window -- Windows locks in a process's DPI
        # awareness mode at that point, so setting it here (after the App's
        # root window already exists) is too late to do anything.
        user32 = ctypes.windll.user32
        self.origin_x = user32.GetSystemMetrics(76)  # SM_XVIRTUALSCREEN
        self.origin_y = user32.GetSystemMetrics(77)  # SM_YVIRTUALSCREEN
        width = user32.GetSystemMetrics(78)          # SM_CXVIRTUALSCREEN
        height = user32.GetSystemMetrics(79)         # SM_CYVIRTUALSCREEN
        if width <= 0 or height <= 0:
            self.origin_x = self.origin_y = 0
            width, height = self.window.winfo_screenwidth(), self.window.winfo_screenheight()
        self.width, self.height = width, height
        # The primary monitor's top-left is always at absolute (0, 0) in
        # Windows' coordinate system, regardless of monitor arrangement.
        # HUD text should anchor to *that* corner, not the combined virtual
        # desktop's -- otherwise "top-right" lands on whichever monitor
        # happens to be physically rightmost/bottommost in the arrangement.
        self.primary_right = -self.origin_x + user32.GetSystemMetrics(0)  # SM_CXSCREEN
        self.primary_top = -self.origin_y
        x_offset = f"+{self.origin_x}" if self.origin_x >= 0 else str(self.origin_x)
        y_offset = f"+{self.origin_y}" if self.origin_y >= 0 else str(self.origin_y)
        self.window.geometry(f"{width}x{height}{x_offset}{y_offset}")
        self.canvas = tk.Canvas(self.window, bg="#010101", highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)
        self.window.update_idletasks()
        self._hwnd = self.window.winfo_id()
        self._base_ex_style = user32.GetWindowLongW(self._hwnd, -20) | 0x08000000
        user32.SetWindowLongW(self._hwnd, -20, self._base_ex_style | 0x20)
        try:
            # Keep the HUD and crop mask out of screenshots on supported Windows versions.
            user32.SetWindowDisplayAffinity(self._hwnd, 0x11)
        except (AttributeError, OSError):
            pass

    def clear(self) -> None:
        self.canvas.delete("all")

    def set_interactive(self, interactive: bool) -> None:
        """Toggle whether the overlay captures mouse clicks (region-select drag)
        or lets them pass through to whatever is underneath (the normal HUD state)."""
        user32 = ctypes.windll.user32
        style = self._base_ex_style if interactive else self._base_ex_style | 0x20
        user32.SetWindowLongW(self._hwnd, -20, style)

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
                                    text="CLICK AND DRAG TO SELECT · RIGHT-CLICK TO CANCEL",
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
        color = "#44e5ff"
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
                                text=f"{right - left} × {bottom - top}  •  RELEASE TO CAPTURE",
                                fill=color, font=("Consolas", 10, "bold"), anchor="w")

    def draw_command(self, command, delivery, buffer) -> None:
        right, top = self.primary_right, self.primary_top
        if buffer.running:
            seconds = int(buffer.seconds)
            self.canvas.create_text(right - 24, top + 22,
                                    text=f"● BUFFER {seconds // 60:02d}:{seconds % 60:02d}",
                                    fill="#74f7c5", font=("Consolas", 9, "bold"), anchor="e")
        if command.phase in ("arming", "armed") and command.route == "replay":
            x, y, radius = right - 68, top + 82, 38
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
            self.canvas.create_text(right - 24, top + 44, text=delivery.mode, fill=color,
                                    font=("Consolas", 9, "bold"), anchor="e")
