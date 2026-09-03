import assert from "node:assert/strict";
import test from "node:test";
import { GestureCommandDetector, RegionSelectionDetector } from "../src/lib/gesture.ts";
import { evenlySpaced } from "../src/lib/replay-buffer.ts";

test("주먹 다음 손바닥은 영역 선택을 한 번만 시작한다", () => {
  const detector = new GestureCommandDetector();
  assert.equal(detector.update("fist", 0), null);
  assert.equal(detector.update("fist", 130), null);
  assert.equal(detector.update("other", 180), null);
  assert.equal(detector.update("other", 220), null);
  assert.equal(detector.update("palm", 260), "start-region");
  assert.equal(detector.update("palm", 360), null);
});

test("빠르게 편 손의 중간 자세도 주먹→손바닥 영역 선택을 유지한다", () => {
  const detector = new GestureCommandDetector();
  detector.update("fist", 0);
  detector.update("other", 60);
  assert.equal(detector.update("palm", 100), "start-region");
});

test("손을 펴는 동안 추적을 잠깐 잃어도 손바닥 2초 모드로 빠지지 않는다", () => {
  const detector = new GestureCommandDetector();
  detector.update("fist", 0);
  detector.update("none", 80);
  detector.update("other", 140);
  assert.equal(detector.update("palm", 220), "start-region");
  assert.equal(detector.progress(220).command, "start-region");
});

test("손바닥을 2초 유지하면 최근 구간을 보낸다", () => {
  const detector = new GestureCommandDetector();
  detector.update("palm", 0);
  detector.update("palm", 300);
  assert.equal(detector.update("palm", 1_999), null);
  assert.equal(detector.update("palm", 2_000), "send-replay");
});

test("손바닥 원형 타이머는 2초까지 진행률을 제공한다", () => {
  const detector = new GestureCommandDetector();
  detector.update("palm", 1_000);
  detector.update("palm", 1_300);
  assert.equal(detector.progress(2_000).value, 0.5);
  detector.update("palm", 3_000);
  assert.equal(detector.progress(3_000).value, 1);
  assert.equal(detector.progress(3_000).phase, "sent");
});

test("손이 사라진 뒤에만 다음 명령을 허용한다", () => {
  const detector = new GestureCommandDetector();
  detector.update("fist", 0);
  detector.update("fist", 130);
  assert.equal(detector.update("palm", 200), "start-region");
  assert.equal(detector.update("fist", 1_000), null);
  detector.update("none", 1_010);
  detector.update("fist", 2_000);
  detector.update("fist", 2_130);
  assert.equal(detector.update("palm", 2_200), "start-region");
});

test("검지로 영역을 늘리고 주먹을 유지하면 선택 영역을 확정한다", () => {
  const selector = new RegionSelectionDetector();
  selector.start();
  selector.update("point", { x: 0.2, y: 0.25 }, 0);
  const resized = selector.update("point", { x: 0.75, y: 0.8 }, 100);
  assert.deepEqual(resized.rect, { left: 0.2, top: 0.25, right: 0.75, bottom: 0.8 });
  assert.equal(selector.update("fist", null, 200).phase, "confirming");
  assert.deepEqual(selector.update("fist", null, 421).captured, resized.rect);
});

test("전송 후보가 많으면 처음부터 끝까지 균등하게 고른다", () => {
  assert.deepEqual(evenlySpaced([0, 1, 2, 3, 4, 5, 6], 4), [0, 2, 4, 6]);
  assert.deepEqual(evenlySpaced([0, 1, 2], 1), [2]);
});
