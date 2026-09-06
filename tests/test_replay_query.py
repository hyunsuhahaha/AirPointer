import json
import subprocess
import sys
import time
from pathlib import Path

import cv2
import numpy as np

from airpointer.replay_query import main as replay_query_main
from airpointer.replay_query import query_frame
from airpointer.screen_buffer import (
    Segment,
    ScreenReplayBuffer,
    read_manifest_hint,
    write_manifest,
)

REPO_ROOT = Path(__file__).resolve().parents[1]


def _write_segment(path: Path, color: int, size: tuple[int, int] = (64, 48), fps: int = 5) -> None:
    width, height = size
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    assert writer.isOpened()
    frame = np.zeros((height, width, 3), dtype=np.uint8)
    frame[:] = color
    for _ in range(fps):
        writer.write(frame)
    writer.release()


def test_write_manifest_copies_segments_and_writes_frame_query(tmp_path: Path) -> None:
    source_dir = tmp_path / "source"
    source_dir.mkdir()
    seg_path = source_dir / "seg.mp4"
    _write_segment(seg_path, color=100)
    segment = Segment(seg_path, started=1000.0, ended=1001.0, size=seg_path.stat().st_size)

    folder = tmp_path / "capture"
    folder.mkdir()
    manifest_path = write_manifest(folder, triggered_at=1000.5, segments=[segment])

    assert manifest_path == folder / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["triggeredAt"] == 1000.5
    assert len(manifest["segments"]) == 1
    copied_path = Path(manifest["segments"][0]["path"])
    assert copied_path.exists() and copied_path.parent == folder / "segments"
    assert "frameQuery" in manifest and manifest["frameQuery"]["command"]


def test_read_manifest_hint_survives_being_read(tmp_path: Path) -> None:
    source_dir = tmp_path / "source"
    source_dir.mkdir()
    seg_path = source_dir / "seg.mp4"
    _write_segment(seg_path, color=100)
    segment = Segment(seg_path, started=1000.0, ended=1001.0, size=seg_path.stat().st_size)

    folder = tmp_path / "capture"
    folder.mkdir()
    write_manifest(folder, triggered_at=1000.5, segments=[segment])
    picked = (folder / "frame-01.png",)  # doesn't need to exist -- only .parent is used

    hint = read_manifest_hint(picked)
    assert "다른 시점 조회" in hint
    assert (folder / "manifest.json").exists(), "unlike region hints, the manifest must not be deleted"

    hint_again = read_manifest_hint(picked)
    assert hint_again == hint


def test_read_manifest_hint_empty_without_a_manifest(tmp_path: Path) -> None:
    folder = tmp_path / "capture"
    folder.mkdir()
    assert read_manifest_hint((folder / "frame-01.png",)) == ""
    assert read_manifest_hint(()) == ""


def test_sweep_expired_manifests_deletes_only_what_is_past_the_ttl(tmp_path: Path) -> None:
    buffer = ScreenReplayBuffer(lambda: 60, lambda: 5, tmp_path / "replay")
    now = time.time()

    fresh = buffer.dispatch / "fresh"
    fresh.mkdir(parents=True)
    (fresh / "manifest.json").write_text(json.dumps({"createdAt": now}), encoding="utf-8")

    expired = buffer.dispatch / "expired"
    expired.mkdir(parents=True)
    (expired / "manifest.json").write_text(json.dumps({"createdAt": now - 700}), encoding="utf-8")

    no_manifest = buffer.dispatch / "plain"
    no_manifest.mkdir(parents=True)

    buffer._sweep_expired_manifests(now)

    assert fresh.exists(), "well within _MANIFEST_TTL_SECONDS (600s) -- must survive"
    assert not expired.exists(), "past the TTL -- must be swept"
    assert no_manifest.exists(), "no manifest.json at all -- sweep must leave it alone"


def test_query_frame_extracts_the_requested_offset(tmp_path: Path) -> None:
    source_dir = tmp_path / "source"
    source_dir.mkdir()
    seg_a, seg_b = source_dir / "a.mp4", source_dir / "b.mp4"
    _write_segment(seg_a, color=50)
    _write_segment(seg_b, color=200)
    triggered_at = 1000.0
    segments = [
        Segment(seg_a, started=triggered_at - 2.0, ended=triggered_at - 1.0, size=seg_a.stat().st_size),
        Segment(seg_b, started=triggered_at - 1.0, ended=triggered_at, size=seg_b.stat().st_size),
    ]
    folder = tmp_path / "capture"
    folder.mkdir()
    manifest_path = write_manifest(folder, triggered_at, segments)

    result = query_frame(manifest_path, offset_seconds=-1.5)  # lands in seg_a's window

    assert Path(result["framePath"]).exists()
    assert -2.0 <= result["actualOffsetSeconds"] <= -1.0
    frame = cv2.imread(result["framePath"])
    assert frame is not None
    pixel = int(frame[0, 0, 0])
    # mp4v lossy compression drifts the exact value a bit -- what actually
    # matters is that this came from seg_a (fill 50), not seg_b (fill 200).
    assert abs(pixel - 50) < abs(pixel - 200)


def test_replay_query_main_handles_multiple_offsets_and_bad_input(tmp_path: Path, capsys) -> None:
    source_dir = tmp_path / "source"
    source_dir.mkdir()
    seg_path = source_dir / "seg.mp4"
    _write_segment(seg_path, color=80)
    segment = Segment(seg_path, started=1000.0, ended=1001.0, size=seg_path.stat().st_size)
    folder = tmp_path / "capture"
    folder.mkdir()
    manifest_path = write_manifest(folder, triggered_at=1000.5, segments=[segment])

    assert replay_query_main([str(manifest_path), "-0.3", "0.1"]) == 0
    results = json.loads(capsys.readouterr().out)
    assert len(results) == 2

    assert replay_query_main([str(manifest_path), "not-a-number"]) == 2
    assert replay_query_main([str(manifest_path)]) == 2  # no offsets at all


def test_launcher_replay_frame_flag_dispatches_without_touching_tk(tmp_path: Path) -> None:
    # The real integration point Codex would actually invoke -- must exit
    # cleanly without ever constructing App()/Tk (see airpointer_launcher.py's
    # early --replay-frame branch), which would be slow and pointless for a
    # one-shot frame query.
    source_dir = tmp_path / "source"
    source_dir.mkdir()
    seg_path = source_dir / "seg.mp4"
    _write_segment(seg_path, color=120)
    segment = Segment(seg_path, started=1000.0, ended=1001.0, size=seg_path.stat().st_size)
    folder = tmp_path / "capture"
    folder.mkdir()
    manifest_path = write_manifest(folder, triggered_at=1000.5, segments=[segment])

    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "airpointer_launcher.py"), "--replay-frame", str(manifest_path), "-0.5"],
        cwd=REPO_ROOT, capture_output=True, text=True, timeout=30,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert Path(payload[0]["framePath"]).exists()
