import assert from "node:assert/strict";
import test from "node:test";
import { GestureCommandDetector, RegionSelectionDetector } from "../src/lib/gesture.ts";
import { evenlySpaced, replayPointsAtOffsets, selectNotable, surroundingReplayOffsets } from "../src/lib/replay-buffer.ts";
import { DEMO_SCENARIOS, demoFrameState } from "../src/lib/demo-replay.ts";
import { formatReplayRange, replayExplorationRequestsFrom } from "../src/lib/replay-frame-request.ts";
import { sensitiveCategory } from "../src/lib/privacy-redaction.ts";

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

test("근거 타임머신은 선택 시점 전후 2초를 오래된 순서로 조회한다", () => {
  const offsets = surroundingReplayOffsets(6.4, 15);
  assert.equal(offsets.length, 9);
  assert.deepEqual([offsets[0], offsets[4], offsets.at(-1)], [-7.4, -6.4, -5.4]);
});

test("실시간 탐색 단계는 AI가 요청한 시간 범위를 읽기 쉽게 표시한다", () => {
  assert.equal(formatReplayRange([-4, -7.6, -6.4]), "-7.6~-4초");
  assert.equal(formatReplayRange([-6.4]), "-6.4초");
});

test("로컬 개인정보 탐지는 키·토큰·메일·전화·카드번호를 분류한다", () => {
  assert.equal(sensitiveCategory("OPENAI_API_KEY=sk-proj-abc12345XYZ"), "API 키");
  assert.equal(sensitiveCategory("Authorization: Bearer abc.def.123456789"), "인증 토큰");
  assert.equal(sensitiveCategory("hello@example.com"), "이메일");
  assert.equal(sensitiveCategory("010-1234-5678"), "전화번호");
  assert.equal(sensitiveCategory("4111 1111 1111 1111"), "카드번호");
  assert.equal(sensitiveCategory("ResultsPanel.tsx:84"), null);
});

test("순수 브라우저도 네이티브와 같이 대표 프레임을 최대 6장만 고른다", () => {
  const candidates = Array.from({ length: 60 }, (_, index) => ({ capturedAt: index * 250 }));
  const selected = selectNotable(candidates, [], 6);
  assert.equal(selected.length, 6);
  assert.equal(selected[0].capturedAt, 0);
  assert.equal(selected.at(-1)?.capturedAt, 14_750);
});

test("AI가 대표 프레임 사이의 시점을 요청하면 브라우저 로컬 세그먼트로 매핑한다", () => {
  const calls = [
    { type: "function_call", name: "request_replay_frames", arguments: JSON.stringify({ offsets_seconds: [-8.2, -5.7, -8.2, -99] }) },
    { type: "function_call", name: "request_replay_crop", arguments: JSON.stringify({ frame_number: 2, left: 0.4, top: 0.2, right: 0.9, bottom: 0.6 }) },
  ];
  assert.deepEqual(replayExplorationRequestsFrom(calls, 15, 6, 8), [
    { type: "frames", offsetsSeconds: [-8.2, -5.7] },
    { type: "crop", frameIndex: 1, bbox: [0.4, 0.2, 0.9, 0.6] },
  ]);
  const segments = [
    { blob: {} as Blob, startedAt: 1_000, durationMs: 1_000 },
    { blob: {} as Blob, startedAt: 2_000, durationMs: 1_000 },
  ];
  assert.deepEqual(replayPointsAtOffsets(segments, 3_000, [-1.5]), [{ segmentIndex: 0, ratio: 0.5, capturedAt: 1_500, offsetSeconds: -1.5 }]);
});

test("60초 체험 리플레이의 오류는 0.5초 동안만 존재한다", () => {
  assert.equal(demoFrameState(-6.26), "building");
  assert.equal(demoFrameState(-6.24), "error");
  assert.equal(demoFrameState(-5.76), "error");
  assert.equal(demoFrameState(-5.74), "failed");
});

test("모든 체험 시나리오는 같은 0.5초 탐색 창과 사용자 질문을 사용한다", () => {
  assert.deepEqual(DEMO_SCENARIOS.map(({ id }) => id), ["runtime", "payment", "inventory", "meeting"]);
  assert.ok(DEMO_SCENARIOS.every(({ question, focusBox }) => question.length > 10 && focusBox.every((value) => value >= 0 && value <= 1)));
  assert.equal(new Set(DEMO_SCENARIOS.map(({ question }) => question)).size, DEMO_SCENARIOS.length);
});
