import assert from "node:assert/strict";
import test from "node:test";
import { evenlySpaced, replayGapOffsets, replayPointsAtOffsets, selectNotable, surroundingReplayOffsets, withReplayBookmarks } from "../src/lib/replay-buffer.ts";
import { DEMO_SCENARIOS, demoFrameState } from "../src/lib/demo-replay.ts";
import { formatReplayRange, replayExplorationRequestsFrom } from "../src/lib/replay-frame-request.ts";
import { sensitiveCategory } from "../src/lib/privacy-redaction.ts";

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

test("리플레이 북마크는 N초 대표 프레임을 건드리지 않고 별도 이미지로 추가한다", () => {
  const base = Array.from({ length: 6 }, (_, index) => ({ url: `base-${index}`, atSeconds: index }));
  const bookmarks = [{ url: "marked-before-window", atSeconds: 0, capturedAt: 1_000 }];
  const combined = withReplayBookmarks(base, bookmarks, 25_000);
  assert.deepEqual(combined.slice(0, 6), base);
  assert.deepEqual(combined[6], { url: "marked-before-window", capturedAt: 1_000, atSeconds: 24, sampleOffsetsSeconds: [24], kind: "bookmarked-frame" });
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

test("AI가 기존 프레임만 다시 요청하면 가장 큰 미탐색 간격을 보완한다", () => {
  const frames = [5.46, 5.21, 3.16, 1.4, 0.39, 0.14].map((atSeconds) => ({ url: "", atSeconds }));
  assert.deepEqual(replayGapOffsets(frames, 3), [-4.185, -2.28, -0.895]);
});

test("60초 체험 리플레이의 오류는 0.5초 동안만 존재한다", () => {
  assert.equal(demoFrameState(-6.26), "building");
  assert.equal(demoFrameState(-6.24), "error");
  assert.equal(demoFrameState(-5.76), "error");
  assert.equal(demoFrameState(-5.74), "failed");
});

test("모든 체험 시나리오는 재현 가능한 실제 실행 녹화와 사용자 질문을 사용한다", () => {
  assert.deepEqual(DEMO_SCENARIOS.map(({ id }) => id), ["worktree", "migration", "test"]);
  assert.ok(DEMO_SCENARIOS.every(({ question, focusBox, video, proof }) => question.length > 10 && focusBox.every((value) => value >= 0 && value <= 1) && video.endsWith(".webm") && proof.includes("실제")));
  assert.equal(new Set(DEMO_SCENARIOS.map(({ question }) => question)).size, DEMO_SCENARIOS.length);
});
