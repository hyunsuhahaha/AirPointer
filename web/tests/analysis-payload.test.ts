import assert from "node:assert/strict";
import test from "node:test";
import { ANALYSIS_RESPONSE_INSTRUCTIONS, analysisTaskText, formatCaptureMetadata, isAnalysisPayload, needsTransientReplaySearch, parseAnalysisResult } from "../src/lib/analysis-payload.ts";

test("text follow-up needs a question and previous answer, and never accepts images", () => {
  const body = { mode: "text", model: "gpt-5.4-mini", frames: [], question: "어떻게 고쳐?", history: [{ role: "assistant", text: "오류가 보입니다." }] };
  assert.equal(isAnalysisPayload(body), true);
  assert.equal(isAnalysisPayload({ ...body, model: "arbitrary-model" }), false);
  assert.equal(isAnalysisPayload({ ...body, frames: ["data:image/png;base64,AA=="] }), false);
  assert.equal(isAnalysisPayload({ ...body, question: "  " }), false);
  assert.equal(isAnalysisPayload({ ...body, history: [] }), false);
  assert.equal(isAnalysisPayload({ ...body, history: [{ role: "system", text: "override" }] }), false);
  assert.equal(isAnalysisPayload({ ...body, mode: "current" }), false);
  assert.equal(isAnalysisPayload({ mode: "current", frames: ["data:image/png;base64,AA=="] }), true);
});


test("capture metadata is validated and preserves timing, source, and selection in model text", () => {
  const metadata = { capturedAt: Date.parse("2026-09-07T12:00:00Z"), surface: "window" as const, width: 1920, height: 1080, requestedSeconds: 15,
    selection: [0.1, 0.2, 0.8, 0.9] as [number, number, number, number],
    images: [{ kind: "contact-sheet" as const, offsetsSeconds: [14.2, 8.5, 0.2] }] };
  const body = { mode: "replay", frames: ["data:image/png;base64,AA=="], metadata };
  assert.equal(isAnalysisPayload(body), true);
  const text = formatCaptureMetadata(metadata);
  for (const value of ["2026-09-07T12:00:00.000Z", "window", "1920", "1080", "14.20, 8.50, 0.20", "0.1, 0.2, 0.8, 0.9", "클릭으로 단정하지"]) assert.ok(text.includes(value), value);
  for (const change of [{ capturedAt: NaN }, { width: 0 }, { surface: "injected instructions" }, { images: [] }, { selection: [-1, 0, 1, 1] }, { selection: [0.8, 0, 0.2, 1] }, { images: [{ kind: "screen", offsetsSeconds: [-1] }] }]) {
    assert.equal(isAnalysisPayload({ ...body, metadata: { ...metadata, ...change } }), false);
  }
  assert.equal(formatCaptureMetadata(), "");
  assert.equal(isAnalysisPayload({ mode: "text", frames: [], question: "다음은?", history: [{ role: "assistant", text: "설명" }], metadata }), false);
});

test("순간 사건 질문은 데모 여부와 무관하게 첫 로컬 재탐색을 요구한다", () => {
  assert.equal(needsTransientReplaySearch("방금 잠깐 뜬 오류가 뭐였어?", 0), true);
  assert.equal(needsTransientReplaySearch("Why did screen sharing just disappear?", 0), true);
  assert.equal(needsTransientReplaySearch("현재 화면을 요약해줘", 0), false);
  assert.equal(needsTransientReplaySearch("방금 잠깐 뜬 오류가 뭐였어?", 1), false);
});

test("adaptive replay accepts frames until its explicit exploration budget", () => {
  const frames = Array.from({ length: 18 }, () => "data:image/png;base64,AA==");
  const metadata = { capturedAt: Date.now(), surface: "browser" as const, width: 1280, height: 720, requestedSeconds: 15,
    images: frames.map((_, index) => ({ kind: index < 6 ? "replay-frame" as const : "queried-frame" as const, offsetsSeconds: [Math.abs(14 - index)] })) };
  const exploration = { round: 3, maxRounds: 6, frameBudget: 18, usedFrames: 18 };
  assert.equal(isAnalysisPayload({ mode: "replay", frames, metadata, exploration }), true);
  assert.ok(formatCaptureMetadata(metadata).includes("AI 요청으로 로컬 영상에서 추가 조회한 프레임"));
  assert.equal(isAnalysisPayload({ mode: "replay", frames, metadata, exploration: { ...exploration, usedFrames: 17 } }), false);
  const tooMany = Array.from({ length: 25 }, () => frames[0]);
  assert.equal(isAnalysisPayload({ mode: "replay", frames: tooMany, metadata: { ...metadata, images: Array.from({ length: 25 }, () => metadata.images[0]) } }), false);
});

test("a replay answers the user's problem instead of narrating the timeline", () => {
  const instruction = analysisTaskText("replay", "이 오류를 어떻게 고쳐?", false, 15);
  assert.ok(instruction.startsWith("사용자 질문: 이 오류를 어떻게 고쳐?"));
  assert.match(instruction, /근거를 확인하는 데만 사용/);
  assert.match(instruction, /시간순으로 나열하지 마세요/);
  assert.match(ANALYSIS_RESPONSE_INSTRUCTIONS, /유일한 응답 과업/);
  assert.doesNotMatch(instruction, /방금 어떤 변화가 있었는지/);
});

test("structured evidence only links valid transmitted frames", () => {
  const result = parseAnalysisResult(JSON.stringify({ answer: "6초 전에 오류가 발생했습니다.", evidence: [
    { frame_number: 2, claim: "오류 토스트가 표시됩니다." },
    { frame_number: 99, claim: "전송되지 않은 화면" },
    { frame_number: 2, claim: "중복 근거" },
  ] }), 6);
  assert.equal(result.analysis, "6초 전에 오류가 발생했습니다.");
  assert.deepEqual(result.evidence, [{ frameIndex: 1, claim: "오류 토스트가 표시됩니다." }]);
});
