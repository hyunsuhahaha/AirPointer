import json
from pathlib import Path

from airpointer import mcp_install


def test_register_claude_desktop_creates_a_new_config(tmp_path: Path) -> None:
    path = tmp_path / "claude_desktop_config.json"

    changed = mcp_install.register_claude_desktop(path, python="python.exe", repo_root=tmp_path)

    assert changed is True
    config = json.loads(path.read_text(encoding="utf-8"))
    entry = config["mcpServers"][mcp_install.SERVER_NAME]
    assert entry["command"] == "python.exe"
    assert entry["args"] == ["-m", "airpointer.mcp_server"]
    assert entry["env"]["PYTHONPATH"] == str(tmp_path)


def test_register_claude_desktop_preserves_other_servers_and_backs_up(tmp_path: Path) -> None:
    path = tmp_path / "claude_desktop_config.json"
    path.write_text(json.dumps({"mcpServers": {"other": {"command": "node", "args": []}}}), encoding="utf-8")

    mcp_install.register_claude_desktop(path, python="python.exe", repo_root=tmp_path)

    config = json.loads(path.read_text(encoding="utf-8"))
    assert config["mcpServers"]["other"] == {"command": "node", "args": []}
    assert mcp_install.SERVER_NAME in config["mcpServers"]
    assert path.with_name(path.name + ".bak").is_file()


def test_register_claude_desktop_is_idempotent(tmp_path: Path) -> None:
    path = tmp_path / "claude_desktop_config.json"

    first = mcp_install.register_claude_desktop(path, python="python.exe", repo_root=tmp_path)
    backup = path.with_name(path.name + ".bak")
    backup.unlink(missing_ok=True)
    second = mcp_install.register_claude_desktop(path, python="python.exe", repo_root=tmp_path)

    assert first is True
    assert second is False
    assert not backup.exists()  # nothing changed, so nothing needed backing up again


def test_register_codex_creates_a_new_config(tmp_path: Path) -> None:
    path = tmp_path / "config.toml"

    changed = mcp_install.register_codex(path, python="python.exe", repo_root=tmp_path)

    assert changed is True
    text = path.read_text(encoding="utf-8")
    assert f"[mcp_servers.{mcp_install.SERVER_NAME}]" in text
    assert 'command = "python.exe"' in text
    assert '"-m", "airpointer.mcp_server"' in text


def test_register_codex_preserves_unrelated_sections_and_backs_up(tmp_path: Path) -> None:
    path = tmp_path / "config.toml"
    path.write_text('[mcp_servers.other]\ncommand = "node"\nargs = []\n\n[model]\nname = "gpt"\n', encoding="utf-8")

    mcp_install.register_codex(path, python="python.exe", repo_root=tmp_path)

    text = path.read_text(encoding="utf-8")
    assert '[mcp_servers.other]' in text
    assert 'command = "node"' in text
    assert '[model]' in text
    assert 'name = "gpt"' in text
    assert path.with_name(path.name + ".bak").is_file()


def test_register_codex_replaces_only_its_own_stale_block(tmp_path: Path) -> None:
    path = tmp_path / "config.toml"
    path.write_text(
        f'[mcp_servers.{mcp_install.SERVER_NAME}]\ncommand = "old-python"\nargs = ["-m", "old"]\n\n'
        '[mcp_servers.other]\ncommand = "node"\nargs = []\n',
        encoding="utf-8",
    )

    changed = mcp_install.register_codex(path, python="python.exe", repo_root=tmp_path)

    text = path.read_text(encoding="utf-8")
    assert changed is True
    assert "old-python" not in text
    assert 'command = "python.exe"' in text
    assert '[mcp_servers.other]' in text
    assert 'command = "node"' in text


def test_register_codex_is_idempotent(tmp_path: Path) -> None:
    path = tmp_path / "config.toml"

    first = mcp_install.register_codex(path, python="python.exe", repo_root=tmp_path)
    backup = path.with_name(path.name + ".bak")
    backup.unlink(missing_ok=True)
    second = mcp_install.register_codex(path, python="python.exe", repo_root=tmp_path)

    assert first is True
    assert second is False
    assert not backup.exists()


def test_main_reports_success_without_touching_real_config_paths(tmp_path: Path, monkeypatch) -> None:
    claude_path = tmp_path / "claude_desktop_config.json"
    codex_path = tmp_path / "config.toml"
    monkeypatch.setattr(mcp_install, "claude_desktop_config_path", lambda: claude_path)
    monkeypatch.setattr(mcp_install, "codex_config_path", lambda: codex_path)

    exit_code = mcp_install.main([])

    assert exit_code == 0
    assert claude_path.is_file()
    assert codex_path.is_file()
