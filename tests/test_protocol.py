from __future__ import annotations

from airpointer.companion_bridge import CompanionState
from airpointer.protocol import command_from_arguments, protocol_command, token_from_arguments


def test_protocol_url_commands_are_parsed() -> None:
    assert command_from_arguments(["airpointer://start_hotkey"]) == "start_hotkey"
    assert token_from_arguments(["airpointer://start_hotkey?token=session-123"]) == "session-123"
    assert command_from_arguments(["AIRPOINTER://show/"]) == "show"
    assert command_from_arguments(["stop"]) == "stop"


def test_unknown_protocol_command_is_ignored() -> None:
    assert command_from_arguments(["airpointer://delete-everything"]) is None


def test_development_protocol_command_quotes_paths() -> None:
    command = protocol_command()
    assert "airpointer_launcher.py" in command
    assert command.endswith('"%1"')


def test_companion_state_exposes_hotkey_status_and_session() -> None:
    state = CompanionState()
    state.authorize("browser-session")
    state.set_running(True, "hotkey")
    snapshot = state.snapshot("browser-session")
    assert snapshot and snapshot["running"] is True and snapshot["mode"] == "hotkey"
    assert state.snapshot("wrong-session") is None
    assert not state.configure("wrong-session", "thread-wrong")
    assert state.configure("browser-session", "thread-selected", {"region": "ctrl+alt+r"})
    assert state.agent_thread_id() == "thread-selected"
    assert state.hotkeys() == {"region": "ctrl+alt+r"}
    state.authorize("second-browser-session")
    assert state.snapshot("browser-session") is not None
    assert state.snapshot("second-browser-session") is not None
