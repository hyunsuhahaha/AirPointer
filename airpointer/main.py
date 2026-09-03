from __future__ import annotations

import threading
import tkinter as tk
from tkinter import ttk

from PIL import Image, ImageTk

from .camera import CameraLoop
from .cursor import CursorController
from .gaze import GazeTracker
from .overlay import Overlay
from .settings import Settings
from .ui_snap import UISnapper


class App:
    def __init__(self) -> None:
        self.root = tk.Tk()
        self.root.title("AirPointer")
        self.root.configure(bg="#07131c")
        self.root.resizable(False, False)
        self.settings = Settings()
        self.snapper = UISnapper(self.settings.snap_radius)
        self.cursor = CursorController(self.settings, self.snapper)
        self.gaze = GazeTracker()
        self._frame = None
        self._frame_version = 0
        self._drawn_frame_version = -1
        self._frame_lock = threading.Lock()
        self._preview_photo = None
        self._gaze: tuple[float, float] | None = None
        self._last_mode = ""
        self.camera = CameraLoop(self.settings, self.cursor, self.gaze, self._set_frame)
        self.overlay = Overlay(self.root)
        self._build_ui()
        self.root.update_idletasks()
        self.root.geometry(f"390x{self.root.winfo_reqheight()}")
        self.root.protocol("WM_DELETE_WINDOW", self._close)
        self.root.after(16, self._redraw)

    def _build_ui(self) -> None:
        style = ttk.Style(self.root)
        style.theme_use("clam")
        style.configure("TFrame", background="#07131c")
        style.configure("TLabel", background="#07131c", foreground="#bdeeff", font=("Segoe UI", 10))
        style.configure("TCheckbutton", background="#07131c", foreground="#bdeeff")
        style.map("TCheckbutton", background=[("active", "#07131c")])
        style.configure("TButton", background="#0e3a4a", foreground="#8cf1ff",
                        bordercolor="#39dff5", font=("Segoe UI", 10, "bold"), padding=8)
        style.map("TButton", background=[("active", "#14556b")])
        style.configure("Horizontal.TScale", background="#07131c", troughcolor="#173441")
        frame = ttk.Frame(self.root, padding=24)
        frame.pack(fill="both", expand=True)
        ttk.Label(frame, text="AIRPOINTER // v0.2", foreground="#44e5ff",
                  font=("Consolas", 19, "bold")).pack(anchor="w", pady=(0, 4))
        ttk.Label(frame, text="SPATIAL POINTER INTERFACE", foreground="#527f91",
                  font=("Consolas", 8)).pack(anchor="w", pady=(0, 15))

        camera_row = ttk.Frame(frame)
        camera_row.pack(fill="x", pady=5)
        ttk.Label(camera_row, text="Camera").pack(side="left")
        camera = ttk.Spinbox(camera_row, from_=0, to=9, width=5,
                             command=lambda: setattr(self.settings, "camera_index", int(camera.get())))
        camera.set("0")
        camera.pack(side="right")

        self.preview = tk.Canvas(frame, width=320, height=180, bg="#02090d",
                                 highlightbackground="#1d8295", highlightthickness=1)
        self.preview.pack(pady=(8, 6))
        self.preview.create_text(160, 90, text="CAMERA OFFLINE", fill="#527f91", font=("Consolas", 10))

        mapping_row = ttk.Frame(frame)
        mapping_row.pack(fill="x", pady=(7, 2))
        ttk.Label(mapping_row, text="Mapping").pack(side="left")
        mapping_var = tk.StringVar(value="Absolute pointing")
        mapping = ttk.Combobox(mapping_row, textvariable=mapping_var, state="readonly", width=18,
                               values=("Absolute pointing", "Relative hand"))
        mapping.pack(side="right")
        mapping.bind("<<ComboboxSelected>>", lambda _event: setattr(
            self.settings, "mapping_mode",
            "absolute" if mapping_var.get() == "Absolute pointing" else "relative"))

        self._scale(frame, "Sensitivity", 0.6, 1.8, self.settings.sensitivity,
                    lambda value: setattr(self.settings, "sensitivity", float(value)))
        self._scale(frame, "Responsiveness", 0.05, 0.35, self.settings.smoothing,
                    lambda value: setattr(self.settings, "smoothing", float(value)))
        self._scale(frame, "Pinch threshold", 0.20, 0.55, self.settings.pinch_threshold,
                    lambda value: setattr(self.settings, "pinch_threshold", float(value)))
        self._scale(frame, "Wink sensitivity", 0.60, 0.85, self.settings.wink_sensitivity,
                    lambda value: setattr(self.settings, "wink_sensitivity", float(value)))

        mouse_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(frame, text="Mouse Control", variable=mouse_var,
                        command=lambda: self.cursor.set_mouse_enabled(mouse_var.get())).pack(
                            anchor="w", pady=(10, 2))

        snap_var = tk.BooleanVar(value=True)
        snap = ttk.Checkbutton(frame, text="UI Snap", variable=snap_var,
                               command=lambda: setattr(self.settings, "snap_enabled", snap_var.get()))
        snap.pack(anchor="w", pady=(2, 10))
        if not self.snapper.available:
            snap.state(["disabled"])
            snap_var.set(False)
            self.settings.snap_enabled = False

        self.gaze_button = ttk.Button(frame, text="Calibrate Gaze (13 points)",
                                      command=self._calibrate_gaze)
        self.gaze_button.pack(fill="x", pady=(2, 8))

        self.status = ttk.Label(frame, text="SYSTEM READY", foreground="#74f7c5", font=("Consolas", 9))
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
            self.status.config(text="SYSTEM STANDBY")
        else:
            self.camera.start()
            self.button.config(text="Stop")
            self.status.config(text="TRACKING // FIST TO CLUTCH")

    def _set_frame(self, frame, gaze: tuple[float, float] | None = None) -> None:
        with self._frame_lock:
            self._frame = frame
            self._gaze = gaze
            self._frame_version += 1

    def _calibrate_gaze(self) -> None:
        if not self.camera.running:
            self.camera.start()
            self.button.config(text="Stop")
        self.gaze.start()

    def _redraw(self) -> None:
        state = self.cursor.current_state()
        self.overlay.draw(state)
        self.overlay.draw_gaze(self._gaze)
        calibration = self.gaze.view()
        self.overlay.draw_calibration(calibration)
        if calibration.target:
            mode = f"GAZE CALIBRATION {calibration.index + 1}/{calibration.total}"
        else:
            mode = state.mode.upper() if state else ("SEARCHING FOR HAND" if self.camera.running else "SYSTEM STANDBY")
        self.gaze_button.config(text="Recalibrate Gaze" if calibration.calibrated else
                                "Calibrate Gaze (13 points)")
        if mode != self._last_mode:
            self.status.config(text=mode)
            self._last_mode = mode
        with self._frame_lock:
            frame = self._frame
            version = self._frame_version
        if version != self._drawn_frame_version:
            self.preview.delete("all")
            if frame is None:
                self.preview.create_text(160, 90, text="CAMERA OFFLINE", fill="#527f91",
                                         font=("Consolas", 10))
                self._preview_photo = None
            else:
                self._preview_photo = ImageTk.PhotoImage(Image.fromarray(frame))
                self.preview.create_image(160, 90, image=self._preview_photo)
            self._drawn_frame_version = version
        self.root.after(16, self._redraw)

    def _close(self) -> None:
        self.camera.stop()
        self.cursor.close()
        self.root.destroy()

    def run(self) -> None:
        self.root.mainloop()


if __name__ == "__main__":
    App().run()
