from __future__ import annotations

from airpointer.companion_bridge import CompanionState
from airpointer.command_gesture import CommandView
from airpointer.protocol import command_from_arguments, protocol_command, token_from_arguments


def test_protocol_url_commands_are_parsed() -> None:
    assert command_from_arguments(["airpointer://start"]) == "start"
    assert token_from_arguments(["airpointer://start?token=session-123"]) == "session-123"
    assert command_from_arguments(["AIRPOINTER://show/"]) == "show"
    assert command_from_arguments(["stop"]) == "stop"


def test_unknown_protocol_command_is_ignored() -> None:
    assert command_from_arguments(["airpointer://delete-everything"]) is None


def test_development_protocol_command_quotes_paths() -> None:
    command = protocol_command()
    assert "airpointer_launcher.py" in command
    assert command.endswith('"%1"')


def test_companion_state_exposes_the_native_palm_progress_and_event() -> None:
    state = CompanionState()
    state.authorize("browser-session")
    state.set_running(True)
    state.publish(None, "palm", CommandView("armed", 0.5, route="replay"))
    snapshot = state.snapshot("browser-session")
    assert snapshot and snapshot["pose"] == "palm" and snapshot["progress"] == 0.5
    assert state.snapshot("wrong-session") is None
    assert not state.configure("wrong-session", "thread-wrong")
    assert state.configure("browser-session", "thread-selected", {"region": False})
    assert state.agent_thread_id() == "thread-selected"
    assert state.gesture_flags() == (True, True, False)
    state.authorize("second-browser-session")
    assert state.snapshot("browser-session") is not None
    assert state.snapshot("second-browser-session") is not None
    state.publish(None, "palm", CommandView("cooldown", 1.0, "replay", "replay"))
    assert state.snapshot("browser-session")["replayEvent"] == 1
