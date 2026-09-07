"""Registers `python -m airpointer.mcp_server` as a stdio MCP server in
Codex's and Claude Desktop's own config files, closing the gap
docs/screen-memory.md used to document: "MCP 등록 파일을 자동 수정하지
않습니다." Run it yourself:

    python -m airpointer.mcp_install

Nothing in the app calls this automatically -- registration stays an
explicit, one-time step the user runs, the same way `python -m
airpointer.mcp_server` itself is something a client config points at
rather than something AirPointer launches on its own.

Idempotent: re-running with an already-up-to-date entry changes nothing
and reports no change. Any file this module is about to modify is backed
up first (a sibling `.bak`), since both files are real config a person's
existing Codex/Claude Desktop setup depends on -- this only ever touches
this one entry, never reformats or removes anything else already there.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path

SERVER_NAME = "airpointer-screen-memory"
_REPO_ROOT = Path(__file__).resolve().parent.parent


def codex_config_path() -> Path:
    return Path(os.environ.get("CODEX_HOME", Path.home() / ".codex")) / "config.toml"


def claude_desktop_config_path() -> Path:
    if sys.platform == "win32":
        return Path(os.environ.get("APPDATA", Path.home())) / "Claude" / "claude_desktop_config.json"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Claude" / "claude_desktop_config.json"
    return Path.home() / ".config" / "Claude" / "claude_desktop_config.json"


def _backup(path: Path) -> None:
    if path.is_file():
        shutil.copy2(path, path.with_name(path.name + ".bak"))


def _entry(python: str | None, repo_root: Path) -> dict:
    # env.PYTHONPATH (not `cwd`) is what makes `-m airpointer.mcp_server`
    # resolve regardless of the working directory a client happens to
    # launch the server from -- `cwd` is Codex-only (not part of Claude
    # Desktop's documented schema), PYTHONPATH works for both.
    return {"command": python or sys.executable, "args": ["-m", "airpointer.mcp_server"],
            "env": {"PYTHONPATH": str(repo_root)}}


def register_claude_desktop(path: Path | None = None, python: str | None = None,
                            repo_root: Path | None = None) -> bool:
    """Returns True if the file was created or changed."""
    path = path or claude_desktop_config_path()
    config = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
    if not isinstance(config, dict):
        raise ValueError(f"{path} does not contain a JSON object")
    servers = config.setdefault("mcpServers", {})
    entry = _entry(python, repo_root or _REPO_ROOT)
    if servers.get(SERVER_NAME) == entry:
        return False
    servers[SERVER_NAME] = entry
    _backup(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return True


def register_codex(path: Path | None = None, python: str | None = None,
                   repo_root: Path | None = None) -> bool:
    """Line-based TOML edit, not a round-trip through a TOML-writing
    library: config.toml is the user's own file (comments, unrelated
    sections, formatting), and a generic writer could reformat all of it
    just to add one table. This only ever replaces the
    `[mcp_servers.<SERVER_NAME>]` block (appending one if absent) and
    leaves every other line byte-for-byte untouched."""
    path = path or codex_config_path()
    lines = path.read_text(encoding="utf-8").splitlines() if path.is_file() else []
    entry = _entry(python, repo_root or _REPO_ROOT)
    section = f"[mcp_servers.{SERVER_NAME}]"
    block = [
        section,
        f"command = {json.dumps(entry['command'])}",
        f"args = {json.dumps(entry['args'])}",
        f"env = {{ PYTHONPATH = {json.dumps(entry['env']['PYTHONPATH'])} }}",
    ]
    start = next((index for index, line in enumerate(lines) if line.strip() == section), None)
    if start is None:
        if lines and lines[-1].strip():
            lines.append("")
        lines.extend(block)
    else:
        end = start + 1
        while end < len(lines) and not lines[end].lstrip().startswith("["):
            end += 1
        if [line for line in lines[start:end] if line.strip()] == block:
            return False
        lines[start:end] = block
    _backup(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return True


def main(argv: list[str] | None = None) -> int:
    changed: list[str] = []
    failed: list[str] = []
    for label, register, path_fn in (
        ("Claude Desktop", register_claude_desktop, claude_desktop_config_path),
        ("Codex", register_codex, codex_config_path),
    ):
        try:
            if register():
                changed.append(f"{label}: {path_fn()}")
        except Exception as error:
            failed.append(f"{label}: {error}")
    if changed:
        print("등록 완료 (기존 파일은 .bak으로 백업됨):")
        for line in changed:
            print(f"  {line}")
    if not changed and not failed:
        print("이미 등록되어 있습니다 (변경 없음).")
    for line in failed:
        print(f"등록 실패 - {line}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
