import numpy as np

from airpointer.gaze import GazeTracker


def test_gaze_requires_calibration_then_learns_screen_mapping() -> None:
    tracker = GazeTracker(settle_seconds=0.0, sample_seconds=0.01)
    assert tracker.update((0.0,) * 12, now=0.0) is None

    tracker.start()
    for index, target in enumerate(tracker.TARGETS):
        feature = _feature_for(target)
        tracker.update(feature, now=index * 0.02)
        tracker.update(feature, now=index * 0.02 + 0.011)

    prediction = tracker.update(_feature_for((0.85, 0.15)), now=1.0)
    assert prediction is not None
    assert np.allclose(prediction, (0.85, 0.15), atol=0.08)
    assert tracker.view(now=1.0).calibrated


def _feature_for(target: tuple[float, float]) -> tuple[float, ...]:
    x, y = target
    return (x, y, x, y, x * x, y * y, x * x, y * y,
            x * y, x * y, x * x, y * y)
