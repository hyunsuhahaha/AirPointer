from dataclasses import dataclass


@dataclass(slots=True)
class Settings:
    camera_index: int = 0
    sensitivity: float = 1.0
    smoothing: float = 0.30
    snap_enabled: bool = True
    snap_radius: int = 80
    pinch_threshold: float = 0.34

