import assert from "node:assert/strict";
import test from "node:test";
import { formatCaptureMetadata, isAnalysisPayload } from "../src/lib/analysis-payload.ts";

test("text follow-up needs a question and previous answer, and never accepts images", () => {
  const body = { mode: "text", frames: [], question: "어떻게 고쳐?", history: [{ role: "assistant", text: "오류가 보입니다." }] };
  assert.equal(isAnalysisPayload(body), true);
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
