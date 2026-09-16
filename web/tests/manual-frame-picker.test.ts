import assert from "node:assert/strict";
import test from "node:test";
import { buildManualTimeline } from "../src/lib/manual-frame-picker.ts";

test("대표 화면만 먼저 보이고 사이 화면은 gap에 남으며 기본 선택 상태를 만들지 않는다", () => {
  const previews = [1, 2, 3, 4, 5].map((second) => ({ dataUrl: `frame-${second}`, capturedAt: second * 1_000 }));
  const overview = [1, 3, 5].map((second) => ({ url: `representative-${second}`, capturedAt: second * 1_000, atSeconds: 5 - second }));
  const timeline = buildManualTimeline(previews, overview);
  assert.deepEqual(timeline.representatives.map((frame) => frame.capturedAt), [1_000, 3_000, 5_000]);
  assert.deepEqual(timeline.representatives.map((frame) => frame.url), ["representative-1", "representative-3", "representative-5"]);
  assert.deepEqual(timeline.gaps.map((gap) => gap.frames.map((frame) => frame.capturedAt)), [[2_000], [4_000]]);
  assert.equal(timeline.representatives.some((frame) => "selected" in frame), false);
});
