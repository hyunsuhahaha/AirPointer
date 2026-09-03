from __future__ import annotations

import threading
import time
import tkinter as tk
from tkinter import ttk

from PIL import Image, ImageTk

from .camera import CameraLoop
from .capture_controller import CaptureController
from .codex_delivery import AgentThread, CodexAppServer
from .command_gesture import CommandEvent, CommandView
from .cursor import CursorController
from .gaze import GazeTracker
from .overlay import Overlay
from .screen_buffer import ScreenReplayBuffer
from .settings import Settings
from .ui_snap import UISnapper


class App:
    def __init__(self) -> None:
        self.root = tk.Tk()
        self.root.title("AirPointer")
        self.root.configure(bg="#07131c")
        self.root.resizable(False, False)
        self.settings = Settings.load()
        self.snapper = UISnapper(self.settings.snap_radius)
        self.cursor = CursorController(self.settings, self.snapper)
        self.gaze = GazeTracker()
        self._frame = None
        self._frame_version = 0
        self._drawn_frame_version = -1
        self._frame_lock = threading.Lock()
        self._preview_photo = None
        self._gaze: tuple[float, float] | None = None
        self._command = CommandView()
        self._last_mode = ""
        self._agent_thread_id = self.settings.agent_thread_id
        self._agent_labels: dict[str, str] = {}
        self._refreshing_agents = False
        self.codex = CodexAppServer()
        self.screen_buffer = ScreenReplayBuffer(
            lambda: self.settings.replay_minutes * 60,
            lambda: self.settings.capture_fps,
        )
        self.capture = CaptureController(
            self.screen_buffer, self.codex, lambda: self.settings.replay_seconds)
        self.camera = CameraLoop(
            self.settings, self.cursor, self.gaze, self._set_frame, self._handle_command)
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
        shell = ttk.Frame(self.root, padding=(18, 14))
        shell.pack(fill="both", expand=True)
        ttk.Label(shell, text="AIRPOINTER // v0.3", foreground="#44e5ff",
                  font=("Consolas", 19, "bold")).pack(anchor="w", pady=(0, 4))
        ttk.Label(shell, text="SPATIAL POINTER + AGENT REPLAY", foreground="#527f91",
                  font=("Consolas", 8)).pack(anchor="w", pady=(0, 10))

        notebook = ttk.Notebook(shell)
        notebook.pack(fill="both", expand=True)
        frame = ttk.Frame(notebook, padding=(12, 9))
        replay = ttk.Frame(notebook, padding=16)
        notebook.add(frame, text="Pointer")
        notebook.add(replay, text="Agent Replay")
        notebook.bind("<<NotebookTabChanged>>", lambda _event: self._refresh_agents_once(
            notebook.index(notebook.select()) == 1))

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

        self._build_replay_ui(replay)

    def _build_replay_ui(self, frame) -> None:
        ttk.Label(frame, text="AGENT TARGET", foreground="#44e5ff",
                  font=("Consolas", 10, "bold")).pack(anchor="w", pady=(0, 6))
        self.agent_var = tk.StringVar(value="Select a Codex task")
        self.agent_combo = ttk.Combobox(frame, textvariable=self.agent_var, state="readonly", width=36)
        self.agent_combo.pack(fill="x")
        self.agent_combo.bind("<<ComboboxSelected>>", self._select_agent)
        ttk.Button(frame, text="Refresh Tasks", command=self._refresh_agents).pack(fill="x", pady=(6, 14))

        replay_var = tk.BooleanVar(value=self.settings.replay_enabled)
        ttk.Checkbutton(frame, text="Screen Replay Buffer", variable=replay_var,
                        command=lambda: self._set_replay_enabled(replay_var.get())).pack(anchor="w")
        self._combo_setting(frame, "Keep recent", (1, 3, 5), self.settings.replay_minutes,
                            lambda value: setattr(self.settings, "replay_minutes", int(value)), "minutes")
        self._combo_setting(frame, "Send previous", (5, 15, 30, 60), self.settings.replay_seconds,
                            lambda value: setattr(self.settings, "replay_seconds", int(value)), "seconds")
        self._combo_setting(frame, "Capture rate", (5, 10, 15), self.settings.capture_fps,
                            lambda value: setattr(self.settings, "capture_fps", int(value)), "FPS")

        ttk.Label(frame, text="PALM → FIST    CURRENT SCREEN", foreground="#74f7c5",
                  font=("Consolas", 9)).pack(anchor="w", pady=(18, 3))
        ttk.Label(frame, text="HOLD PALM      RECENT REPLAY", foreground="#74f7c5",
                  font=("Consolas", 9)).pack(anchor="w")
        self.buffer_status = ttk.Label(frame, text="BUFFER STOPPED", foreground="#527f91",
                                       font=("Consolas", 9))
        self.buffer_status.pack(anchor="w", pady=(18, 3))
        self.delivery_status = ttk.Label(frame, text="CODEX READY", foreground="#527f91",
                                         font=("Consolas", 9), wraplength=320)
        self.delivery_status.pack(anchor="w", pady=(0, 10))
        buttons = ttk.Frame(frame)
        buttons.pack(fill="x")
        ttk.Button(buttons, text="Clear Buffer", command=self.screen_buffer.clear).pack(
            side="left", fill="x", expand=True, padx=(0, 3))
        ttk.Button(buttons, text="Retry Send", command=self.capture.retry).pack(
            side="left", fill="x", expand=True, padx=(3, 0))

    @staticmethod
    def _combo_setting(parent, label, values, current, command, suffix) -> None:
        row = ttk.Frame(parent)
        row.pack(fill="x", pady=(10, 0))
        ttk.Label(row, text=label).pack(side="left")
        variable = tk.StringVar(value=f"{current} {suffix}")
        combo = ttk.Combobox(row, textvariable=variable, state="readonly", width=12,
                             values=tuple(f"{value} {suffix}" for value in values))
        combo.pack(side="right")
        combo.bind("<<ComboboxSelected>>", lambda _event: command(variable.get().split()[0]))

    @staticmethod
    def _scale(parent, label, start, end, value, command) -> None:
        ttk.Label(parent, text=label).pack(anchor="w", pady=(7, 0))
        ttk.Scale(parent, from_=start, to=end, value=value, command=command).pack(fill="x")

    def _toggle(self) -> None:
        if self.camera.running:
            self.camera.stop()
            self.screen_buffer.stop(clear=True)
            self.button.config(text="Start")
            self.status.config(text="SYSTEM STANDBY")
        else:
            if self.settings.replay_enabled:
                self.screen_buffer.start()
            self.camera.start()
            self.button.config(text="Stop")
            self.status.config(text="TRACKING // FIST TO CLUTCH")

    def _set_frame(self, frame, gaze: tuple[float, float] | None = None,
                   command: CommandView = CommandView()) -> None:
        with self._frame_lock:
            self._frame = frame
            self._gaze = gaze
            self._command = command
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
        delivery = self.capture.status()
        buffer = self.screen_buffer.status()
        self.overlay.draw_command(self._command, delivery, buffer)
        if calibration.target:
            mode = f"GAZE CALIBRATION {calibration.index + 1}/{calibration.total}"
        else:
            mode = state.mode.upper() if state else ("SEARCHING FOR HAND" if self.camera.running else "SYSTEM STANDBY")
        self.gaze_button.config(text="Recalibrate Gaze" if calibration.calibrated else
                                "Calibrate Gaze (13 points)")
        if mode != self._last_mode:
            self.status.config(text=mode)
            self._last_mode = mode
        buffer_text = (f"BUFFERING • {int(buffer.seconds) // 60:02d}:{int(buffer.seconds) % 60:02d}"
                       if buffer.running else "BUFFER STOPPED")
        if buffer.error:
            buffer_text = f"BUFFER ERROR • {buffer.error}"
        self.buffer_status.config(text=buffer_text)
        detail = f" • {delivery.detail}" if delivery.detail else ""
        if delivery.last_sent:
            detail += f" • {time.strftime('%H:%M:%S', time.localtime(delivery.last_sent))}"
        self.delivery_status.config(text=delivery.mode + detail)
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
        self.capture.close()
        self.cursor.close()
        self.settings.agent_thread_id = self._agent_thread_id
        self.settings.save()
        self.root.destroy()

    def _handle_command(self, event: CommandEvent) -> None:
        self.capture.trigger(event, self._agent_thread_id)

    def _set_replay_enabled(self, enabled: bool) -> None:
        self.settings.replay_enabled = enabled
        if enabled and self.camera.running:
            self.screen_buffer.start()
        elif not enabled:
            self.screen_buffer.stop(clear=True)

    def _refresh_agents_once(self, replay_selected: bool) -> None:
        if replay_selected and not self._agent_labels:
            self._refresh_agents()

    def _refresh_agents(self) -> None:
        if self._refreshing_agents:
            return
        self._refreshing_agents = True
        self.delivery_status.config(text="LOADING CODEX TASKS")

        def load() -> None:
            try:
                threads = self.codex.list_threads(str(__import__("pathlib").Path.cwd()))
                if not threads:
                    threads = self.codex.list_threads()
                error = ""
            except Exception as caught:
                threads, error = [], str(caught)
            try:
                self.root.after(0, self._apply_agents, threads, error)
            except tk.TclError:
                pass

        threading.Thread(target=load, name="airpointer-agent-list", daemon=True).start()

    def _apply_agents(self, threads: list[AgentThread], error: str) -> None:
        self._refreshing_agents = False
        if error:
            self.delivery_status.config(text=f"CODEX ERROR • {error}")
            return
        self._agent_labels = {
            f"{thread.title} · {thread.id[-6:]}": thread.id for thread in threads
        }
        labels = tuple(self._agent_labels)
        self.agent_combo.config(values=labels)
        selected = next((label for label, thread_id in self._agent_labels.items()
                         if thread_id == self._agent_thread_id), labels[0] if labels else "")
        if selected:
            self.agent_var.set(selected)
            self._agent_thread_id = self._agent_labels[selected]
            self.delivery_status.config(text=f"CODEX CONNECTED • {len(labels)} TASKS")
        else:
            self.delivery_status.config(text="NO CODEX TASKS FOUND")

    def _select_agent(self, _event=None) -> None:
        self._agent_thread_id = self._agent_labels.get(self.agent_var.get(), "")
        self.settings.agent_thread_id = self._agent_thread_id

    def run(self) -> None:
        self.root.mainloop()


if __name__ == "__main__":
    App().run()
