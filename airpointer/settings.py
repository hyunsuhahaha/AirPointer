from dataclasses import dataclass


@dataclass(slots=True)
class Settings:
    camera_index: int = 0
    mapping_mode: str = "absolute"
    sensitivity: float = 1.0
    smoothing: float = 0.18
    snap_enabled: bool = True
    snap_radius: int = 80
    pinch_threshold: float = 0.34
