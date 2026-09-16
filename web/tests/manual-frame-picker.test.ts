import assert from "node:assert/strict";
import test from "node:test";
import { buildManualTimeline, visibleManualFrames } from "../src/lib/manual-frame-picker.ts";

test("대표 화면만 먼저 보이고 사이 화면은 gap에 남으며 기본 선택 상태를 만들지 않는다", () => {
  const previews = [1, 2, 3, 4, 5].map((second) => ({ dataUrl: `frame-${second}`, capturedAt: second * 1_000 }));
  const overview = [1, 3, 5].map((second) => ({ url: `representative-${second}`, capturedAt: second * 1_000, atSeconds: 5 - second }));
  const timeline = buildManualTimeline(previews, overview);
  assert.deepEqual(timeline.representatives.map((frame) => frame.capturedAt), [1_000, 3_000, 5_000]);
  assert.deepEqual(timeline.representatives.map((frame) => frame.url), ["representative-1", "representative-3", "representative-5"]);
  assert.equal(timeline.representatives.every((frame) => frame.highResolution), true);
  assert.deepEqual(timeline.gaps.map((gap) => gap.frames.map((frame) => frame.capturedAt)), [[2_000], [4_000]]);
  assert.equal(timeline.gaps.every((gap) => gap.frames.every((frame) => !frame.highResolution && frame.url === frame.previewUrl)), true);
  assert.equal(timeline.representatives.some((frame) => "selected" in frame), false);
});

test("확대 보기의 다음 화면은 펼친 구간에서는 사이 화면, 접힌 구간에서는 다음 대표다", () => {
  const previews = [1, 2, 3, 4, 5].map((second) => ({ dataUrl: `frame-${second}`, capturedAt: second * 1_000 }));
  const overview = [1, 3, 5].map((second) => ({ url: `representative-${second}`, capturedAt: second * 1_000, atSeconds: 5 - second }));
  const timeline = buildManualTimeline(previews, overview);

  assert.deepEqual(visibleManualFrames(timeline, new Set()).map((frame) => frame.capturedAt), [1_000, 3_000, 5_000]);
  assert.deepEqual(visibleManualFrames(timeline, new Set([timeline.gaps[0].id])).map((frame) => frame.capturedAt),
    [1_000, 2_000, 3_000, 5_000]);
  assert.deepEqual(visibleManualFrames(timeline, new Set(timeline.gaps.map((gap) => gap.id))).map((frame) => frame.capturedAt),
    [1_000, 2_000, 3_000, 4_000, 5_000]);
});

test("같은 초에 찍힌 대표 화면은 하나만 남는다", () => {
  const previews = [1_000, 2_000, 3_000].map((capturedAt) => ({ dataUrl: `frame-${capturedAt}`, capturedAt }));
  const overview = [1_000, 1_300, 1_900, 3_000].map((capturedAt) => ({ url: `representative-${capturedAt}`, capturedAt, atSeconds: 0 }));
  const timeline = buildManualTimeline(previews, overview);
  assert.deepEqual(timeline.representatives.map((frame) => frame.capturedAt), [1_000, 3_000]);
  assert.deepEqual(timeline.gaps.map((gap) => gap.frames.map((frame) => frame.capturedAt)), [[2_000]]);
});
