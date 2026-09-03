from __future__ import annotations

import threading
import time
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True, slots=True)
class CalibrationView:
    target: tuple[float, float] | None
    progress: float
    index: int
    total: int
    calibrated: bool


class GazeTracker:
    TARGETS = (
        (0.50, 0.50), (0.12, 0.12), (0.88, 0.12),
        (0.12, 0.88), (0.88, 0.88), (0.50, 0.12),
        (0.12, 0.50), (0.88, 0.50), (0.50, 0.88),
    )

    def __init__(self, settle_seconds: float = 0.35, sample_seconds: float = 0.55,
                 smoothing: float = 0.28) -> None:
        self.settle_seconds = settle_seconds
        self.sample_seconds = sample_seconds
        self.smoothing = smoothing
        self._lock = threading.Lock()
        self._index = len(self.TARGETS)
        self._target_started: float | None = None
        self._samples: list[np.ndarray] = []
        self._labels: list[tuple[float, float]] = []
        self._mean: np.ndarray | None = None
        self._scale: np.ndarray | None = None
        self._weights: np.ndarray | None = None
        self._point: tuple[float, float] | None = None

    def start(self) -> None:
        with self._lock:
            self._index = 0
            self._target_started = None
            self._samples.clear()
            self._labels.clear()
            self._point = None

    def update(self, features: tuple[float, ...] | None,
               now: float | None = None) -> tuple[float, float] | None:
        if features is None:
            return None
        timestamp = time.monotonic() if now is None else now
        feature = np.asarray(features, dtype=np.float64)
        with self._lock:
            if self._index < len(self.TARGETS):
                self._collect(feature, timestamp)
                return None
            if self._weights is None:
                return None
            normalized = (feature - self._mean) / self._scale
            prediction = np.append(normalized, 1.0) @ self._weights
            target = (_clamp(float(prediction[0])), _clamp(float(prediction[1])))
            if self._point is None:
                self._point = target
            else:
                amount = self.smoothing
                self._point = (self._point[0] + (target[0] - self._point[0]) * amount,
                               self._point[1] + (target[1] - self._point[1]) * amount)
            return self._point

    def view(self, now: float | None = None) -> CalibrationView:
        timestamp = time.monotonic() if now is None else now
        with self._lock:
            calibrating = self._index < len(self.TARGETS)
            elapsed = 0.0 if self._target_started is None else timestamp - self._target_started
            duration = self.settle_seconds + self.sample_seconds
            return CalibrationView(
                self.TARGETS[self._index] if calibrating else None,
                min(1.0, max(0.0, elapsed / duration)) if calibrating else 0.0,
                self._index,
                len(self.TARGETS),
                self._weights is not None,
            )

    def _collect(self, feature: np.ndarray, now: float) -> None:
        if self._target_started is None:
            self._target_started = now
        elapsed = now - self._target_started
        if elapsed >= self.settle_seconds:
            self._samples.append(feature)
            self._labels.append(self.TARGETS[self._index])
        if elapsed < self.settle_seconds + self.sample_seconds:
            return
        self._index += 1
        self._target_started = now
        if self._index == len(self.TARGETS):
            self._fit()

    def _fit(self) -> None:
        features = np.stack(self._samples)
        labels = np.asarray(self._labels, dtype=np.float64)
        self._mean = features.mean(axis=0)
        self._scale = features.std(axis=0)
        self._scale[self._scale < 1e-6] = 1.0
        normalized = (features - self._mean) / self._scale
        design = np.column_stack((normalized, np.ones(len(normalized))))
        penalty = np.eye(design.shape[1]) * 0.01
        penalty[-1, -1] = 0.0
        self._weights = np.linalg.pinv(design.T @ design + penalty) @ design.T @ labels


def _clamp(value: float) -> float:
    return min(1.0, max(0.0, value))
