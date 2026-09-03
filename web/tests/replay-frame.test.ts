import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ffmpegPath from "ffmpeg-static";

test("Replay Capsule에서 제스처 기준 0.5초 전 원본 프레임을 재조회한다", async () => {
  assert.ok(ffmpegPath);
  const directory = await mkdtemp(join(tmpdir(), "airpointer-replay-test-"));
  try {
    const segmentPath = join(directory, "segment.webm");
    const manifestPath = join(directory, "replay-manifest.json");
    execFileSync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15", "-t", "2", "-c:v", "libvpx-vp9", segmentPath], { windowsHide: true });
    const triggeredAt = 10_000;
    await writeFile(manifestPath, JSON.stringify({ triggeredAt, segments: [{ path: segmentPath, startedAt: 8_000, durationMs: 2_000 }] }));
    const helperPath = join(process.cwd(), "scripts", "replay-frame.mjs");
    const output = execFileSync(process.execPath, [helperPath, manifestPath, "-0.5"], { encoding: "utf8", windowsHide: true });
    const [result] = JSON.parse(output) as Array<{ requestedOffsetSeconds: number; actualOffsetSeconds: number; framePath: string }>;
    assert.equal(result.requestedOffsetSeconds, -0.5);
    assert.equal(result.actualOffsetSeconds, -0.5);
    assert.ok(existsSync(result.framePath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
