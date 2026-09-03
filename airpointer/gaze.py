from __future__ import annotations

import threading
import time
from dataclasses import dataclass

import numpy as np

from .gesture import OneEuro


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
        (0.31, 0.31), (0.69, 0.31), (0.31, 0.69), (0.69, 0.69),
    )

    def __init__(self, settle_seconds: float = 0.45, sample_seconds: float = 0.65,
                 filtering: bool = True) -> None:
        self.settle_seconds = settle_seconds
        self.sample_seconds = sample_seconds
        self.filtering = filtering
        self._lock = threading.Lock()
        self._index = len(self.TARGETS)
        self._target_started: float | None = None
        self._samples: list[list[np.ndarray]] = [[] for _ in self.TARGETS]
        self._mean: np.ndarray | None = None
        self._scale: np.ndarray | None = None
        self._weights: np.ndarray | None = None
        self._point: tuple[float, float] | None = None
        self._x_filter = OneEuro(min_cutoff=0.5, beta=0.08)
        self._y_filter = OneEuro(min_cutoff=0.5, beta=0.08)

    def start(self) -> None:
        with self._lock:
            self._index = 0
            self._target_started = None
            self._samples = [[] for _ in self.TARGETS]
            self._point = None
            self._x_filter.reset()
            self._y_filter.reset()

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
            self._point = ((self._x_filter.update(target[0], timestamp),
                            self._y_filter.update(target[1], timestamp))
                           if self.filtering else target)
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
            self._samples[self._index].append(feature)
        if elapsed < self.settle_seconds + self.sample_seconds:
            return
        self._index += 1
        self._target_started = now
        if self._index == len(self.TARGETS):
            self._fit()

    def _fit(self) -> None:
        features = np.stack([np.median(np.stack(samples), axis=0) for samples in self._samples])
        labels = np.asarray(self.TARGETS, dtype=np.float64)
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
