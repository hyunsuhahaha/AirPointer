from __future__ import annotations

import threading
import time
import tkinter as tk
from tkinter import ttk
from pathlib import Path

from PIL import Image, ImageTk

from .camera import CameraLoop
from .capture_controller import CaptureController
from .click_tracker import ClickTracker
from .codex_delivery import AgentThread, CodexAppServerDelivery, DesktopPasteDelivery
from .companion_bridge import CompanionState
from .command_gesture import CommandEvent, CommandView
from .conversation_picker import ConversationPicker
from .overlay import Overlay
from .region_selection import RegionSelector, SelectionView
from .screen_buffer import ScreenReplayBuffer, cleanup_paths
from .hotkeys import HotkeyListener
from .settings import Settings
from .win32_focus import force_foreground
from .window_tracker import WindowTracker

# Fallback used only for a delivery backend with requires_thread_selection
# = False (none currently) -- there's no real thread id to store in that
# case, just a placeholder that satisfies CaptureController's "a target
# must be chosen" check.
DESKTOP_PASTE_TARGET = "desktop"


class App:
    def __init__(self, start_hidden: bool = False,
                 companion_state: CompanionState | None = None) -> None:
        self.root = tk.Tk()
        self.root.title("AirPointer")
        self.root.configure(bg="#07131c")
        self.root.resizable(False, False)
        self.settings = Settings.load()
        self._frame = None
        self._frame_version = 0
        self._drawn_frame_version = -1
        self._frame_lock = threading.Lock()
        self._preview_photo = None
        self._command = CommandView()
        self._selection = SelectionView()
        self._pose = "none"
        self.companion_state = companion_state
        self._last_mode = ""
        self._active_mode: str | None = None
        self.codex = DesktopPasteDelivery()
        # Hides Codex Desktop's first-query UI Automation cold-start cost
        # (20-30s, measured) behind app startup instead of the user's first
        # real send -- see DesktopPasteDelivery.warmup().
        threading.Thread(target=self.codex.warmup, name="airpointer-codex-warmup", daemon=True).start()
        initial_target = self.settings.agent_thread_id if self.codex.requires_thread_selection else DESKTOP_PASTE_TARGET
        self._agent_thread_id = initial_target or self._fallback_target()
        self._agent_labels: dict[str, str] = {}
        self._refreshing_agents = False
        self._prompt_window: tk.Toplevel | None = None
        self._prompt_kind: str = "replay"
        self._prompt_paths: tuple[Path, ...] = ()
        self._prompt_agent_ids: dict[str, str] = {}
        self.screen_buffer = ScreenReplayBuffer(
            lambda: self.settings.replay_minutes * 60,
            lambda: self.settings.capture_fps,
        )
        self.window_tracker = WindowTracker()
        self.click_tracker = ClickTracker()
        self.capture = CaptureController(
            self.screen_buffer, self.codex, lambda: self.settings.replay_seconds,
            self._activity_summary)
        self.hotkey_listener = HotkeyListener(self._on_hotkey_action, self._resolve_hotkey_bindings)
        self._last_hotkey_hint = ""
        self._region_selector = RegionSelector()
        self._region_selecting = threading.Event()
        self.camera = CameraLoop(
            self.settings, self._set_frame, self._handle_command,
            self.companion_state.gesture_flags if self.companion_state else None,
            self._region_selecting.is_set)
        self.overlay = Overlay(self.root)
        self.overlay.canvas.bind("<ButtonPress-1>", self._region_press)
        self.overlay.canvas.bind("<B1-Motion>", self._region_drag)
        self.overlay.canvas.bind("<ButtonRelease-1>", self._region_release)
        self.overlay.canvas.bind("<ButtonPress-3>", self._cancel_region_select)
        self._build_ui()
        self.root.update_idletasks()
        # Explicit position, not just size: an unpositioned Toplevel's default
        # placement is up to Windows/Tk and isn't guaranteed to land on the
        # primary monitor. This window is normally hidden (start_hidden), but
        # _on_callback_exception can deiconify it on an unrelated error, so
        # pin it to primary's top-left rather than risk it surfacing wherever
        # the OS felt like putting it.
        self.root.geometry(f"390x{self.root.winfo_reqheight()}+40+40")
        self.root.protocol("WM_DELETE_WINDOW", self._close)
        self.root.report_callback_exception = self._on_callback_exception
        self.root.after(16, self._redraw)
        self.root.after(1000, self._refresh_hotkey_hint)
        if start_hidden:
            self.root.withdraw()

    def _on_callback_exception(self, _exc_type, exc_value, exc_tb) -> None:
        # AirPointer.exe runs without a console (pythonw), so the default
        # Tk behaviour of printing to stderr is invisible. Surface failures
        # (camera/MediaPipe init, gesture handling, delivery, ...) as a
        # visible notice and bring the window back so the user can see it.
        import os
        import traceback
        full_detail = "".join(traceback.format_exception(_exc_type, exc_value, exc_tb))
        try:
            log_path = Path(os.environ.get("LOCALAPPDATA", ".")) / "AirPointer" / "ui-error.log"
            log_path.parent.mkdir(parents=True, exist_ok=True)
            with log_path.open("a", encoding="utf-8") as handle:
                handle.write(f"--- {time.strftime('%Y-%m-%d %H:%M:%S')} ---\n{full_detail}\n")
        except OSError:
            pass
        detail = full_detail[-1500:]
        try:
            self.root.deiconify()
            self.root.lift()
        except tk.TclError:
            pass
        self._show_native_notice("AirPointer 오류", f"{exc_value}\n\n{detail}")

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
        shell = ttk.Frame(self.root, padding=(18, 14))
        shell.pack(fill="both", expand=True)
        ttk.Label(shell, text="AIRPOINTER // v0.3", foreground="#44e5ff",
                  font=("Consolas", 19, "bold")).pack(anchor="w", pady=(0, 4))
        ttk.Label(shell, text="GESTURE CAPTURE + AGENT REPLAY", foreground="#527f91",
                  font=("Consolas", 8)).pack(anchor="w", pady=(0, 10))

        notebook = ttk.Notebook(shell)
        notebook.pack(fill="both", expand=True)
        frame = ttk.Frame(notebook, padding=(12, 9))
        replay = ttk.Frame(notebook, padding=16)
        notebook.add(frame, text="Camera")
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

        self.status = ttk.Label(frame, text="SYSTEM READY", foreground="#74f7c5", font=("Consolas", 9))
        self.status.pack(anchor="w", pady=(8, 6))
        self.button = ttk.Button(frame, text="Start", command=self._toggle)
        self.button.pack(fill="x")

        self._build_replay_ui(replay)

    def _build_replay_ui(self, frame) -> None:
        ttk.Label(frame, text="AGENT TARGET", foreground="#44e5ff",
                  font=("Consolas", 10, "bold")).pack(anchor="w", pady=(0, 6))
        if self.codex.requires_thread_selection:
            placeholder = ("Codex 작업 검색..." if self.codex.requires_explicit_target
                          else "현재 열려 있는 대화 (검색하려면 입력)")
            self.agent_picker = ConversationPicker(frame, self._select_agent, bg="#02090d", fg="#bdeeff",
                                                    accent="#44e5ff", muted="#527f91", placeholder=placeholder)
            self.agent_picker.pack(fill="x")
            ttk.Button(frame, text="Refresh Tasks", command=self._refresh_agents).pack(fill="x", pady=(6, 14))
        else:
            ttk.Label(frame, text="● 현재 열려 있는 Codex 대화", foreground="#74f7c5",
                      font=("Consolas", 10)).pack(anchor="w", pady=(0, 14))

        replay_var = tk.BooleanVar(value=self.settings.replay_enabled)
        ttk.Checkbutton(frame, text="Screen Replay Buffer", variable=replay_var,
                        command=lambda: self._set_replay_enabled(replay_var.get())).pack(anchor="w")
        self._combo_setting(frame, "Keep recent", (1, 3, 5), self.settings.replay_minutes,
                            lambda value: setattr(self.settings, "replay_minutes", int(value)), "minutes")
        self._combo_setting(frame, "Send previous", (5, 15, 30, 60), self.settings.replay_seconds,
                            lambda value: setattr(self.settings, "replay_seconds", int(value)), "seconds")
        self._combo_setting(frame, "Capture rate", (5, 10, 15), self.settings.capture_fps,
                            lambda value: setattr(self.settings, "capture_fps", int(value)), "FPS")

        ttk.Label(frame, text="START MODE", foreground="#44e5ff",
                  font=("Consolas", 10, "bold")).pack(anchor="w", pady=(14, 4))
        mode_var = tk.StringVar(value=self.settings.launch_mode)
        mode_row = ttk.Frame(frame)
        mode_row.pack(fill="x")
        ttk.Radiobutton(mode_row, text="Gesture (camera)", variable=mode_var, value="gesture",
                        command=lambda: self._set_launch_mode(mode_var.get())).pack(side="left")
        ttk.Radiobutton(mode_row, text="Hotkey (no camera)", variable=mode_var, value="hotkey",
                        command=lambda: self._set_launch_mode(mode_var.get())).pack(side="left", padx=(12, 0))
        # Editing the combos themselves happens from the browser's companion
        # config (see companion_bridge.CompanionState.configure) -- this is
        # just a read-only reminder of whatever's currently bound, local or
        # browser-sent, so the desktop UI stays truthful without duplicating
        # the editor.
        self._hotkey_hint = ttk.Label(frame, text=self._hotkey_hint_text(), foreground="#527f91",
                                      font=("Consolas", 8), wraplength=320)
        self._hotkey_hint.pack(anchor="w", pady=(2, 0))

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

    def _toggle(self) -> None:
        if self._active_mode:
            self._stop_tracking()
        else:
            self._start_tracking(self.settings.launch_mode)

    def _start_tracking(self, mode: str = "gesture") -> None:
        """`mode` is "gesture" (camera + hand tracking, the original path)
        or "hotkey" (no camera at all -- RegisterHotKey via HotkeyListener
        instead). Mutually exclusive, chosen once at launch: this is meant
        as a genuine alternative for when the camera pipeline is too heavy,
        not a second trigger path layered on top of the camera."""
        self._active_mode = mode
        if self.companion_state:
            self.companion_state.set_running(True, mode)
        if self.settings.replay_enabled:
            self.screen_buffer.start()
        self.window_tracker.start()
        self.click_tracker.start()
        if mode == "hotkey":
            self.hotkey_listener.start()
            self.status.config(text="HOTKEY MODE // SHORTCUTS ACTIVE")
        else:
            self.camera.start()
            self.status.config(text="TRACKING // PALM OR FIST TO CAPTURE")
        self.button.config(text="Stop")

    def _stop_tracking(self) -> None:
        self.camera.stop()
        self.hotkey_listener.stop()
        self.screen_buffer.stop(clear=True)
        self.window_tracker.stop(clear=True)
        self.click_tracker.stop(clear=True)
        self._active_mode = None
        self.button.config(text="Start")
        self.status.config(text="SYSTEM STANDBY")
        if self.companion_state:
            self.companion_state.set_running(False)

    def _activity_summary(self) -> str:
        """Combines the window-switch and click logs into the one string
        CaptureController hands to codex.send() as `window_history` -- kept
        as a single callable/parameter (no new wire format) since both are
        "what the user was doing right before this capture", just two
        different signals of it."""
        parts = []
        windows = self.window_tracker.recent_summary()
        if windows:
            parts.append(f"창 전환: {windows}")
        clicks = self.click_tracker.recent_summary()
        if clicks:
            parts.append(f"클릭: {clicks}")
        return "\n".join(parts)

    @staticmethod
    def _activate_window(window) -> None:
        """Reliably brings `window` to the real OS foreground.
        window.focus_force() alone can silently no-op when this process
        lacks Windows' "recently interactive" standing -- which is
        exactly the case here, since these windows get raised from a
        background camera-gesture callback or a companion-bridge socket
        command, never a genuine click. See win32_focus.py (the same fix
        desktop_paste.py needs for Codex Desktop's own window)."""
        window.deiconify()
        window.lift()
        try:
            force_foreground(window.winfo_id())
        except Exception:
            pass
        window.focus_force()

    def handle_external_command(self, command: str, token: str = "") -> None:
        if self.companion_state:
            self.companion_state.authorize(token)
        if command == "start":
            self.root.withdraw()
            self._start_tracking("gesture")
        elif command == "start_hotkey":
            self.root.withdraw()
            self._start_tracking("hotkey")
        elif command == "stop":
            self._stop_tracking()
            self.root.withdraw()
        elif command == "show":
            self._activate_window(self.root)
        elif command == "quit":
            self._close()

    def _set_frame(self, frame, command: CommandView = CommandView(), pose: str = "none") -> None:
        with self._frame_lock:
            self._frame = frame
            self._command = command
            self._pose = pose
            self._frame_version += 1
        if self.companion_state:
            self.companion_state.publish(frame, pose, command)

    def _redraw(self) -> None:
        self.overlay.clear()
        self.overlay.draw_selection(self._selection)
        delivery = self.capture.status()
        buffer = self.screen_buffer.status()
        self.overlay.draw_command(self._command, delivery, buffer)
        if self._selection.active:
            mode = f"AREA CAPTURE // {self._selection.phase.upper()}"
        elif self.camera.running:
            mode = f"TRACKING // {self._pose.upper()}"
        elif self._active_mode == "hotkey":
            mode = "HOTKEY MODE // SHORTCUTS ACTIVE"
        else:
            mode = "SYSTEM STANDBY"
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
        self._cancel_capture_prompt()
        self._cancel_region_select()
        self.camera.close()
        self.capture.close()
        self.window_tracker.stop(clear=True)
        self.click_tracker.stop(clear=True)
        self.hotkey_listener.stop()
        self.settings.agent_thread_id = self._agent_thread_id
        self.settings.save()
        self.root.destroy()

    def _handle_command(self, event: CommandEvent, _region: None = None) -> None:
        if event == "replay":
            try:
                self.root.after(0, self._begin_capture_prompt, "replay")
            except tk.TclError:
                pass
            return
        if event == "region_select":
            try:
                self.root.after(0, self._begin_region_select)
            except tk.TclError:
                pass
            return
        try:
            self.root.after(0, self._begin_capture_prompt, "screenshot")
        except tk.TclError:
            pass

    def _begin_region_select(self) -> None:
        if self._region_selecting.is_set():
            return
        self._region_selecting.set()
        self._selection = self._region_selector.start()
        self.overlay.set_interactive(True)

    def _region_press(self, event) -> None:
        if not self._region_selecting.is_set():
            return
        self._selection = self._region_selector.press(event.x_root, event.y_root)

    def _region_drag(self, event) -> None:
        if not self._region_selecting.is_set():
            return
        self._selection = self._region_selector.drag(event.x_root, event.y_root)

    def _region_release(self, _event=None) -> None:
        if not self._region_selecting.is_set():
            return
        view, captured = self._region_selector.release()
        self._selection = view
        if captured is None:
            return
        self._end_region_select()
        browser_target = self.companion_state.agent_thread_id() if self.companion_state else ""
        self.capture.trigger("region", browser_target or self._agent_thread_id, captured)

    def _cancel_region_select(self, _event=None) -> None:
        if not self._region_selecting.is_set():
            return
        self._region_selector.reset()
        self._end_region_select()

    def _end_region_select(self) -> None:
        self._region_selecting.clear()
        self._selection = SelectionView()
        self.overlay.set_interactive(False)

    # Every capture kind that can show this prompt (screenshot included --
    # see _handle_command / _dispatch_hotkey_action) funnels through here so
    # there's exactly one prompt window implementation, not one per kind.
    _PROMPT_HEADER = {"screenshot": "SCREEN CAPTURED", "replay": "REPLAY CAPTURED", "region": "REGION CAPTURED"}
    _PROMPT_FREEZE_FAILURE = {
        "screenshot": "화면을 캡처하지 못했습니다.",
        "replay": "최근 화면 버퍼가 아직 준비되지 않았습니다.",
        "region": "영역을 캡처하지 못했습니다.",
    }

    def _begin_capture_prompt(self, kind: str) -> None:
        if self._prompt_window is not None or self._prompt_paths:
            return

        def freeze() -> None:
            try:
                paths = (self.screen_buffer.export_recent(int(self.settings.replay_seconds))
                         if kind == "replay" else self.screen_buffer.capture_still())
                error = ""
            except Exception as caught:
                paths, error = (), str(caught)
            try:
                self.root.after(0, self._show_capture_prompt, kind, paths, error)
            except tk.TclError:
                cleanup_paths(paths)

        threading.Thread(target=freeze, name="airpointer-freeze-capture", daemon=True).start()

    def _show_capture_prompt(self, kind: str, paths: tuple[Path, ...], error: str) -> None:
        if error or not paths:
            self._show_native_notice("화면 고정 실패", error or self._PROMPT_FREEZE_FAILURE.get(kind, "화면 캡처에 실패했습니다."))
            return
        self._prompt_kind = kind
        self._prompt_paths = paths
        window = tk.Toplevel(self.root)
        self._prompt_window = window
        window.overrideredirect(True)
        window.attributes("-topmost", True)
        window.configure(bg="#ff6b22")
        width, height = 500, 280
        x = max(12, window.winfo_screenwidth() - width - 28)
        window.geometry(f"{width}x{height}+{x}+128")

        panel = tk.Frame(window, bg="#11110f", padx=18, pady=16)
        panel.pack(fill="both", expand=True, padx=2, pady=2)
        header_row = tk.Frame(panel, bg="#11110f")
        header_row.pack(fill="x")
        self._prompt_header_var = tk.StringVar(value=self._PROMPT_HEADER.get(kind, "CAPTURED"))
        tk.Label(header_row, textvariable=self._prompt_header_var, bg="#11110f", fg="#ff8a50",
                 font=("Consolas", 10, "bold")).pack(side="left", anchor="w")
        tk.Button(header_row, text="✕", command=self._cancel_capture_prompt, bg="#11110f",
                 fg="#ff8a50", activebackground="#2a1c14", activeforeground="#ff8a50",
                 relief="flat", bd=0, font=("Consolas", 11, "bold"),
                 cursor="hand2").pack(side="right")
        if self.codex.requires_thread_selection:
            placeholder = ("Codex 작업 검색..." if self.codex.requires_explicit_target
                          else "현재 열려 있는 대화 (검색하려면 입력)")
            self._prompt_agent_picker = ConversationPicker(panel, self._on_prompt_agent_picked,
                                                            bg="#090908", fg="#f5f1e8",
                                                            accent="#ff6b22", muted="#7a5a4a",
                                                            placeholder=placeholder)
            self._prompt_agent_picker.pack(fill="x", pady=(14, 10))
        else:
            tk.Label(panel, text="● 현재 열려 있는 Codex 대화", bg="#11110f", fg="#74f7c5",
                     font=("Consolas", 10)).pack(anchor="w", pady=(14, 10))

        self._prompt_text = tk.Text(panel, height=8, wrap="word", bg="#090908", fg="#f5f1e8",
                                    insertbackground="#ff6b22", selectbackground="#7a3418",
                                    relief="flat", padx=12, pady=10, font=("Segoe UI", 11))
        self._prompt_text.pack(fill="both", expand=True)
        self._prompt_text.bind("<Return>", self._on_prompt_return)
        window.bind("<Escape>", self._on_prompt_escape)
        window.protocol("WM_DELETE_WINDOW", self._cancel_capture_prompt)
        self._activate_window(window)
        self._prompt_text.focus_set()
        if self.codex.requires_thread_selection:
            self._load_prompt_agents()

    def _on_prompt_return(self, event) -> str | None:
        if event.state & 0x0001:
            return None
        self._submit_capture_prompt()
        return "break"

    def _on_prompt_escape(self, _event) -> str:
        self._cancel_capture_prompt()
        return "break"

    def _load_prompt_agents(self) -> None:
        def load() -> None:
            try:
                threads = self.codex.list_threads()
                error = ""
            except Exception as caught:
                threads, error = [], str(caught)
            try:
                self.root.after(0, self._apply_prompt_agents, threads, error)
            except tk.TclError:
                pass
        threading.Thread(target=load, name="airpointer-prompt-agents", daemon=True).start()

    def _apply_prompt_agents(self, threads: list[AgentThread], error: str) -> None:
        if self._prompt_window is None:
            return
        if error:
            self._prompt_header_var.set(f"{self._prompt_base_label()} · CODEX ERROR")
            self._show_native_notice("Codex 작업을 불러오지 못했습니다", error)
            return
        self._prompt_agent_ids = self._populate_picker(self._prompt_agent_picker, threads)
        labels = list(self._prompt_agent_ids)
        if self.codex.requires_explicit_target and labels:
            selected = next((label for label, thread_id in self._prompt_agent_ids.items()
                             if thread_id == self._agent_thread_id), labels[0])
            self._prompt_agent_picker.set_value(selected)

    def _prompt_base_label(self) -> str:
        return self._PROMPT_HEADER.get(self._prompt_kind, "CAPTURED")

    def _on_prompt_agent_picked(self, _label: str) -> None:
        if self._prompt_header_var.get() == f"{self._prompt_base_label()} · SELECT CONVERSATION":
            self._prompt_header_var.set(self._prompt_base_label())

    def _submit_capture_prompt(self) -> None:
        if self._prompt_window is None:
            return
        prompt = self._prompt_text.get("1.0", "end").strip()
        if self.codex.requires_thread_selection:
            thread_id = self._prompt_agent_ids.get(self._prompt_agent_picker.get(), "") or self._fallback_target()
            if not thread_id:
                self._prompt_header_var.set(f"{self._prompt_base_label()} · SELECT CONVERSATION")
                return
        else:
            thread_id = DESKTOP_PASTE_TARGET
        if not prompt:
            self._prompt_header_var.set(f"{self._prompt_base_label()} · ENTER PROMPT")
            return
        paths = self._prompt_paths
        if not self.capture.send_prepared(self._prompt_kind, thread_id, paths, prompt):
            self._prompt_header_var.set(f"{self._prompt_base_label()} · BUSY")
            return
        self._prompt_paths = ()
        self._agent_thread_id = thread_id
        self.settings.agent_thread_id = thread_id
        self._destroy_prompt_window()

    def _cancel_capture_prompt(self) -> None:
        paths, self._prompt_paths = self._prompt_paths, ()
        cleanup_paths(paths)
        self._destroy_prompt_window()

    def _destroy_prompt_window(self) -> None:
        window, self._prompt_window = self._prompt_window, None
        self._prompt_agent_ids = {}
        if window is not None:
            try:
                window.destroy()
            except tk.TclError:
                pass

    def _show_native_notice(self, title: str, detail: str) -> None:
        window = tk.Toplevel(self.root)
        window.attributes("-topmost", True)
        window.title(title)
        ttk.Label(window, text=title, font=("Segoe UI", 13, "bold")).pack(
            padx=18, pady=(18, 6), anchor="w")
        if len(detail) > 200:
            window.geometry("640x360+40+40")
            text = tk.Text(window, wrap="word", bg="#11110f", fg="#f5f1e8",
                           relief="flat", padx=12, pady=10, font=("Consolas", 9))
            text.insert("1.0", detail)
            text.config(state="disabled")
            text.pack(fill="both", expand=True, padx=18)
            ttk.Button(window, text="Close", command=window.destroy).pack(pady=10)
        else:
            window.geometry("420x130+40+40")
            ttk.Label(window, text=detail, wraplength=380).pack(padx=18)
            window.after(5000, window.destroy)

    def _set_replay_enabled(self, enabled: bool) -> None:
        self.settings.replay_enabled = enabled
        if enabled and self.camera.running:
            self.screen_buffer.start()
        elif not enabled:
            self.screen_buffer.stop(clear=True)

    def _set_launch_mode(self, mode: str) -> None:
        self.settings.launch_mode = mode

    def _resolve_hotkey_bindings(self) -> dict[str, str]:
        """Local Settings is the base; whatever the browser has configured
        for this session (see companion_bridge.CompanionState.configure)
        wins per-action on top of it, same override relationship the
        browser's agent-thread selection already has over the local one."""
        browser = self.companion_state.hotkeys() if self.companion_state else {}
        return {**self.settings.hotkeys, **browser}

    def _hotkey_hint_text(self) -> str:
        labels = {"screenshot": "캡처", "replay": "리플레이", "region": "영역"}
        bindings = self._resolve_hotkey_bindings()
        if not bindings:
            return "단축키 없음 · 브라우저에서 설정하세요"
        return " · ".join(f"{combo.upper()} {labels.get(action, action)}"
                          for action, combo in bindings.items())

    def _refresh_hotkey_hint(self) -> None:
        text = self._hotkey_hint_text()
        if text != self._last_hotkey_hint:
            self._hotkey_hint.config(text=text)
            self._last_hotkey_hint = text
        self.root.after(1000, self._refresh_hotkey_hint)

    def _on_hotkey_action(self, action: str) -> None:
        # Called from HotkeyListener's own thread -- must not touch Tk
        # directly (same reasoning as CommandServer's handler in protocol.py,
        # which is why airpointer_launcher.py always marshals through
        # root.after rather than calling into the App synchronously).
        try:
            self.root.after(0, self._dispatch_hotkey_action, action)
        except tk.TclError:
            pass

    def _dispatch_hotkey_action(self, action: str) -> None:
        # Same handlers the matching hand gesture already calls (see
        # _handle_command and _region_release) -- only the trigger differs.
        if action == "replay":
            self._begin_capture_prompt("replay")
        elif action == "region":
            self._begin_region_select()
        elif action == "screenshot":
            self._begin_capture_prompt("screenshot")

    def _refresh_agents_once(self, replay_selected: bool) -> None:
        if replay_selected and self.codex.requires_thread_selection and not self._agent_labels:
            self._refresh_agents()

    def _refresh_agents(self) -> None:
        if self._refreshing_agents:
            return
        self._refreshing_agents = True
        self.delivery_status.config(text="LOADING CODEX TASKS")

        def load() -> None:
            try:
                threads = self.codex.list_threads()
                error = ""
            except Exception as caught:
                threads, error = [], str(caught)
            try:
                self.root.after(0, self._apply_agents, threads, error)
            except tk.TclError:
                pass

        threading.Thread(target=load, name="airpointer-agent-list", daemon=True).start()

    @staticmethod
    def _agent_label(thread: AgentThread) -> str:
        # DesktopPasteDelivery's threads have no real id distinct from the
        # title (see codex_delivery.py); appending id[-6:] in that case
        # would just repeat a fragment of the title right back at itself.
        return thread.title if thread.id == thread.title else f"{thread.title} · {thread.id[-6:]}"

    def _fallback_target(self) -> str:
        # CodexAppServerDelivery has no "current thread" concept -- an
        # empty target must keep blocking delivery (requires_explicit_target
        # = True -> "" stays ""). DesktopPasteDelivery's "" is a real,
        # supported choice ("whatever's already open"), but CaptureController
        # still needs a *non-empty* thread_id to not treat it as "nothing
        # selected" -- DESKTOP_PASTE_TARGET is a sentinel that never matches
        # a real conversation title, so it passes through as that default.
        return "" if self.codex.requires_explicit_target else DESKTOP_PASTE_TARGET

    def _populate_picker(self, picker: ConversationPicker, threads: list[AgentThread]) -> dict[str, str]:
        """Feeds `threads` to `picker`, grouped by project (Codex Desktop's
        own sidebar layout) when the delivery backend supports it, or as a
        plain flat list otherwise (e.g. CodexAppServerDelivery, which has no
        project concept). `threads` is already ordered project-block by
        project-block by DesktopPasteDelivery.list_threads(), so a
        run-length grouping on `.project` reconstructs the sidebar's
        grouping without needing a second, parallel API."""
        labels = {self._agent_label(thread): thread.id for thread in threads}
        if getattr(self.codex, "supports_project_groups", False):
            groups: list[tuple[str, list[str]]] = []
            for thread in threads:
                label = self._agent_label(thread)
                if groups and groups[-1][0] == thread.project:
                    groups[-1][1].append(label)
                else:
                    groups.append((thread.project, [label]))
            picker.set_grouped(groups)
        else:
            picker.set_options(list(labels))
        return labels

    def _apply_agents(self, threads: list[AgentThread], error: str) -> None:
        self._refreshing_agents = False
        if error:
            self.delivery_status.config(text=f"CODEX ERROR • {error}")
            return
        self._agent_labels = self._populate_picker(self.agent_picker, threads)
        labels = list(self._agent_labels)
        if not labels:
            self.delivery_status.config(text="NO CODEX TASKS FOUND")
            return
        if self.codex.requires_explicit_target:
            selected = next((label for label, thread_id in self._agent_labels.items()
                             if thread_id == self._agent_thread_id), labels[0])
            self.agent_picker.set_value(selected)
            self._agent_thread_id = self._agent_labels[selected]
        self.delivery_status.config(text=f"CODEX CONNECTED • {len(labels)} TASKS")

    def _select_agent(self, label: str) -> None:
        self._agent_thread_id = self._agent_labels.get(label, "") or self._fallback_target()
        self.settings.agent_thread_id = self._agent_thread_id

    def run(self) -> None:
        self.root.mainloop()


if __name__ == "__main__":
    App().run()
