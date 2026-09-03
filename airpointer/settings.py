from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, fields
from pathlib import Path


@dataclass(slots=True)
class Settings:
    camera_index: int = 0
    mouse_enabled: bool = False
    mapping_mode: str = "absolute"
    sensitivity: float = 1.0
    smoothing: float = 0.18
    snap_enabled: bool = True
    snap_radius: int = 80
    pinch_threshold: float = 0.34
    wink_sensitivity: float = 0.75
    replay_enabled: bool = True
    replay_minutes: int = 3
    replay_seconds: int = 15
    capture_fps: int = 10
    agent_thread_id: str = ""

    @classmethod
    def load(cls, path: Path | None = None) -> Settings:
        target = path or _settings_path()
        try:
            raw = json.loads(target.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            return cls()
        allowed = {field.name for field in fields(cls)}
        return cls(**{key: value for key, value in raw.items() if key in allowed})

    def save(self, path: Path | None = None) -> None:
        target = path or _settings_path()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")


def _settings_path() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    return base / "AirPointer" / "settings.json"
