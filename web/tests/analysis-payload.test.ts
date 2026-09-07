import assert from "node:assert/strict";
import test from "node:test";
import { isAnalysisPayload } from "../src/lib/analysis-payload.ts";

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
