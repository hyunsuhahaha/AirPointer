import assert from "node:assert/strict";
import test from "node:test";
import { GestureCommandDetector } from "../src/lib/gesture.ts";
import { evenlySpaced } from "../src/lib/replay-buffer.ts";

test("손바닥 다음 주먹은 현재 화면 캡처를 한 번만 만든다", () => {
  const detector = new GestureCommandDetector();
  assert.equal(detector.update("palm", 0), null);
  assert.equal(detector.update("palm", 300), null);
  assert.equal(detector.update("fist", 520), "capture-now");
  assert.equal(detector.update("fist", 600), null);
});

test("손바닥을 1.2초 유지하면 최근 구간을 보낸다", () => {
  const detector = new GestureCommandDetector();
  detector.update("palm", 0);
  detector.update("palm", 300);
  assert.equal(detector.update("palm", 1_199), null);
  assert.equal(detector.update("palm", 1_200), "send-replay");
});

test("손이 사라진 뒤에만 다음 명령을 허용한다", () => {
  const detector = new GestureCommandDetector();
  detector.update("palm", 0);
  detector.update("palm", 300);
  detector.update("fist", 400);
  assert.equal(detector.update("palm", 2_000), null);
  detector.update("none", 2_010);
  detector.update("palm", 3_000);
  detector.update("palm", 3_300);
  assert.equal(detector.update("fist", 3_400), "capture-now");
});

test("대표 프레임을 처음부터 끝까지 균등하게 고른다", () => {
  assert.deepEqual(evenlySpaced([0, 1, 2, 3, 4, 5, 6], 4), [0, 2, 4, 6]);
  assert.deepEqual(evenlySpaced([0, 1, 2], 1), [2]);
});
