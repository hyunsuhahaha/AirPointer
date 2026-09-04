from __future__ import annotations

import socket
import sys
import threading
from collections.abc import Callable, Sequence
from pathlib import Path
from urllib.parse import parse_qsl, urlparse

SCHEME = "airpointer"
CONTROL_HOST = "127.0.0.1"
CONTROL_PORT = 47821
VALID_COMMANDS = frozenset({"start", "start_hotkey", "stop", "show", "quit"})


def token_from_arguments(arguments: Sequence[str]) -> str:
    for argument in arguments:
        value = argument.strip()
        if value.lower().startswith(f"{SCHEME}://"):
            token = dict(parse_qsl(urlparse(value).query)).get("token", "")
            if token and len(token) <= 128:
                return token
    return ""


def command_from_arguments(arguments: Sequence[str]) -> str | None:
    """Return a supported command from an airpointer:// URL or plain argument."""
    for argument in arguments:
        value = argument.strip()
        if not value:
            continue
        if value.lower().startswith(f"{SCHEME}://"):
            parsed = urlparse(value)
            command = (parsed.hostname or parsed.path.lstrip("/")).lower()
        else:
            command = value.lower()
        if command in VALID_COMMANDS:
            return command
    return None


def protocol_command() -> str:
    """Build the Windows shell command used for the custom URL protocol."""
    if getattr(sys, "frozen", False):
        executable = Path(sys.executable).resolve()
        return f'"{executable}" "%1"'

    launcher = Path(__file__).resolve().parents[1] / "airpointer_launcher.py"
    executable = Path(sys.executable).resolve()
    pythonw = executable.with_name("pythonw.exe")
    if pythonw.exists():
        executable = pythonw
    return f'"{executable}" "{launcher}" "%1"'


def register_protocol() -> bool:
    """Register airpointer:// for the current Windows user, without elevation."""
    if sys.platform != "win32":
        return False
    import winreg

    root_path = rf"Software\Classes\{SCHEME}"
    command = protocol_command()
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, root_path) as key:
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, "URL:AirPointer Protocol")
        winreg.SetValueEx(key, "URL Protocol", 0, winreg.REG_SZ, "")
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, root_path + r"\DefaultIcon") as key:
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, f'"{Path(sys.executable).resolve()}",0')
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, root_path + r"\shell\open\command") as key:
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, command)
    return True


def send_command(command: str, timeout: float = 0.7, token: str = "") -> bool:
    if command not in VALID_COMMANDS:
        return False
    try:
        with socket.create_connection((CONTROL_HOST, CONTROL_PORT), timeout=timeout) as connection:
            connection.sendall((command + (" " + token if token else "") + "\n").encode("ascii"))
            connection.settimeout(timeout)
            return connection.recv(16).strip() == b"OK"
    except OSError:
        return False


class CommandServer:
    """Small loopback-only control channel used by subsequent protocol launches."""

    def __init__(self) -> None:
        self._socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._socket.bind((CONTROL_HOST, CONTROL_PORT))
        self._socket.listen(4)
        self._socket.settimeout(0.25)
        self._closed = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self, handler: Callable[[str, str], None]) -> None:
        def serve() -> None:
            while not self._closed.is_set():
                try:
                    connection, _address = self._socket.accept()
                except TimeoutError:
                    continue
                except OSError:
                    break
                with connection:
                    try:
                        parts = connection.recv(256).decode("ascii", errors="ignore").strip().split(" ", 1)
                        command = parts[0].lower()
                        token = parts[1] if len(parts) == 2 else ""
                        if command not in VALID_COMMANDS:
                            connection.sendall(b"ERROR\n")
                            continue
                        handler(command, token)
                        connection.sendall(b"OK\n")
                    except OSError:
                        continue

        self._thread = threading.Thread(target=serve, name="airpointer-control", daemon=True)
        self._thread.start()

    def close(self) -> None:
        self._closed.set()
        try:
            self._socket.close()
        except OSError:
            pass
        if self._thread and self._thread is not threading.current_thread():
            self._thread.join(timeout=0.5)
