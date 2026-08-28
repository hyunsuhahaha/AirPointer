from __future__ import annotations

import threading
import tkinter as tk
from tkinter import ttk

from .camera import CameraLoop
from .cursor import CursorController, CursorState
from .overlay import Overlay
from .settings import Settings
from .ui_snap import UISnapper


class App:
    def __init__(self) -> None:
        self.root = tk.Tk()
        self.root.title("AirPointer")
        self.root.resizable(False, False)
        self.settings = Settings()
        self.snapper = UISnapper(self.settings.snap_radius)
        self.cursor = CursorController(self.settings, self.snapper)
        self._state: CursorState | None = None
        self._state_lock = threading.Lock()
        self.camera = CameraLoop(self.settings, self.cursor, self._set_state)
        self.overlay = Overlay(self.root)
        self._build_ui()
        self.root.update_idletasks()
        self.root.geometry(f"390x{self.root.winfo_reqheight()}")
        self.root.protocol("WM_DELETE_WINDOW", self._close)
        self.root.after(16, self._redraw)

    def _build_ui(self) -> None:
        frame = ttk.Frame(self.root, padding=24)
        frame.pack(fill="both", expand=True)
        ttk.Label(frame, text="AirPointer", font=("Segoe UI", 20, "bold")).pack(anchor="w", pady=(0, 18))

        camera_row = ttk.Frame(frame)
        camera_row.pack(fill="x", pady=5)
        ttk.Label(camera_row, text="Camera").pack(side="left")
        camera = ttk.Spinbox(camera_row, from_=0, to=9, width=5,
                             command=lambda: setattr(self.settings, "camera_index", int(camera.get())))
        camera.set("0")
        camera.pack(side="right")

        self._scale(frame, "Sensitivity", 0.6, 1.8, self.settings.sensitivity,
                    lambda value: setattr(self.settings, "sensitivity", float(value)))
        self._scale(frame, "Smoothing", 0.1, 0.8, self.settings.smoothing,
                    lambda value: setattr(self.settings, "smoothing", float(value)))
        self._scale(frame, "Pinch threshold", 0.20, 0.55, self.settings.pinch_threshold,
                    lambda value: setattr(self.settings, "pinch_threshold", float(value)))

        snap_var = tk.BooleanVar(value=True)
        snap = ttk.Checkbutton(frame, text="UI Snap", variable=snap_var,
                               command=lambda: setattr(self.settings, "snap_enabled", snap_var.get()))
        snap.pack(anchor="w", pady=10)
        if not self.snapper.available:
            snap.state(["disabled"])
            snap_var.set(False)
            self.settings.snap_enabled = False

        self.status = ttk.Label(frame, text="Ready")
        self.status.pack(anchor="w", pady=(8, 6))
        self.button = ttk.Button(frame, text="Start", command=self._toggle)
        self.button.pack(fill="x")

    @staticmethod
    def _scale(parent, label, start, end, value, command) -> None:
        ttk.Label(parent, text=label).pack(anchor="w", pady=(7, 0))
        ttk.Scale(parent, from_=start, to=end, value=value, command=command).pack(fill="x")

    def _toggle(self) -> None:
        if self.camera.running:
            self.camera.stop()
            self.button.config(text="Start")
            self.status.config(text="Stopped")
        else:
            self.camera.start()
            self.button.config(text="Stop")
            self.status.config(text="Running — lower your hand to release control")
            self.root.iconify()

    def _set_state(self, state: CursorState | None) -> None:
        with self._state_lock:
            self._state = state

    def _redraw(self) -> None:
        with self._state_lock:
            state = self._state
        self.overlay.draw(state)
        self.root.after(16, self._redraw)

    def _close(self) -> None:
        self.camera.stop()
        self.root.destroy()

    def run(self) -> None:
        self.root.mainloop()


if __name__ == "__main__":
    App().run()
