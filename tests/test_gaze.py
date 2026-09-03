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


def test_calibration_rejects_one_bad_landmark_sample_per_target() -> None:
    tracker = GazeTracker(settle_seconds=0.0, sample_seconds=0.10, filtering=False)
    tracker.start()
    for index, target in enumerate(tracker.TARGETS):
        start = index * 0.12
        tracker.update(_feature_for(target), now=start)
        tracker.update(_feature_for((1 - target[0], 1 - target[1])), now=start + 0.02)
        tracker.update(_feature_for(target), now=start + 0.04)
        tracker.update(_feature_for(target), now=start + 0.06)
        tracker.update(_feature_for(target), now=start + 0.11)

    prediction = tracker.update(_feature_for((0.30, 0.70)), now=5.0)
    assert np.allclose(prediction, (0.30, 0.70), atol=0.08)


def test_stationary_gaze_noise_is_filtered_below_five_pixels_at_1080p() -> None:
    tracker = GazeTracker(settle_seconds=0.0, sample_seconds=0.01)
    tracker.start()
    for index, target in enumerate(tracker.TARGETS):
        tracker.update(_feature_for(target), now=index * 0.02)
        tracker.update(_feature_for(target), now=index * 0.02 + 0.011)

    outputs = []
    for index in range(60):
        jitter = 0.02 if index % 2 else -0.02
        outputs.append(tracker.update(_feature_for((0.5 + jitter, 0.5)),
                                      now=1.0 + index / 30)[0])
    assert (max(outputs[-20:]) - min(outputs[-20:])) * 1920 < 5


def _feature_for(target: tuple[float, float]) -> tuple[float, ...]:
    x, y = target
    return (x, y, x, y, x * x, y * y, x * x, y * y,
            x * y, x * y, x * x, y * y)
