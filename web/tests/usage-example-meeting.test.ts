import assert from "node:assert/strict";
import test from "node:test";
import {
  BEATS, CAPTIONS, CHART_AT_SECONDS, CLICKS, CROP, CROP_BUTTON, DURATION, FRAME_TARGET, GAP_TARGET, MEET_INPUT, QUICK_MANUAL, SLIDES, SOUND_CUES,
  TYPING, aiChatAt, aiInputAt, cursorAt, manualAt, meetingChatAt, recordingAt, slideAt, stripSlots,
} from "../src/lib/usage-example-meeting.ts";
import { INPUT_TARGET, SEND_BUTTON } from "../src/lib/usage-example-timeline.ts";

const near = (a: { x: number; y: number }, b: { x: number; y: number }, tolerance = 2) =>
  Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;

test("커서는 클릭·드래그하는 순간 해당 위치에 있고, 클릭은 시간순이다", () => {
  const targets: [number, { x: number; y: number }][] = [
    [BEATS.meetClick, MEET_INPUT], [BEATS.quickManual, QUICK_MANUAL], [BEATS.gap, GAP_TARGET], [BEATS.frame, FRAME_TARGET],
    [BEATS.cropButton, CROP_BUTTON], [BEATS.send, SEND_BUTTON], [BEATS.meetClick2, MEET_INPUT],
  ];
  for (const [at, target] of targets) assert.ok(near(cursorAt(at), target), `click at ${at}`);
  assert.equal(targets.length, CLICKS.length);
  assert.ok(CLICKS.every((at, index) => index === 0 || at > CLICKS[index - 1]));
  assert.ok(near(cursorAt(BEATS.cropDrag[0]), CROP.start) && near(cursorAt(BEATS.cropDrag[1]), CROP.end));
  assert.ok(near(cursorAt(BEATS.drag[1]), INPUT_TARGET) && near(cursorAt(BEATS.fileDrag[1]), INPUT_TARGET));
});

test("차트는 1초만 보이고, 캡처는 이미 다음 장이며, 다시 보여달라는 말은 지운다", () => {
  assert.equal(SLIDES[2][0] - SLIDES[1][0], 1);
  assert.equal(slideAt(BEATS.snip), "plan");
  assert.ok(meetingChatAt(BEATS.erase[0] - 0.01).input.startsWith("죄송한데"));
  assert.equal(meetingChatAt(BEATS.erase[1]).input, "");
});

test("녹화본은 1초를 찾아 헤매야 하고, AI는 영상 파일을 거절한다", () => {
  assert.equal(recordingAt(BEATS.scrub[1]).seconds, CHART_AT_SECONDS);
  assert.ok(recordingAt((BEATS.scrub[0] + BEATS.scrub[1]) / 2).searching);
  assert.equal(recordingAt(BEATS.rejected[0] + 0.1).rejected, true);
  assert.equal(aiChatAt(BEATS.rejected[1]).length, 0);
});

test("Manual은 사이 화면에서 차트를 찾아 얼굴·채팅 없이 잘라 AI에 넣는다", () => {
  assert.ok(stripSlots(false).every((slot) => slot.frame?.slide !== "chart"));
  assert.ok(stripSlots(true).some((slot) => slot.kind === "middle" && slot.frame?.slide === "chart"));
  const state = manualAt(BEATS.frame + 0.1);
  assert.ok(state.manual && state.expanded && state.lightbox && !state.minimized);
  assert.equal(manualAt(BEATS.privacy[0] + 0.1).privacy, true);
  assert.equal(manualAt(BEATS.cropped).cropped, true);
  assert.ok(aiInputAt(BEATS.drag[1]).image);
  const [question, answer] = aiChatAt(DURATION);
  assert.ok(question.role === "user" && question.image);
  assert.ok(answer.role === "claudy" && answer.text.includes("3.2% → 2.4%") && answer.done !== "");
  assert.ok(meetingChatAt(BEATS.asked).messages.some((message) => message.me));
});

test("자막·소리·타이핑은 재생 시간 안에 있고 자막끼리 겹치지 않는다", () => {
  CAPTIONS.forEach((caption, index) => {
    assert.ok(caption.start < caption.end && caption.end <= DURATION);
    if (index > 0) assert.ok(caption.start >= CAPTIONS[index - 1].end);
  });
  assert.ok(SOUND_CUES.every((cue) => cue.at >= 0 && cue.at <= DURATION));
  assert.ok(TYPING.every(([start, end]) => start < end && end <= DURATION));
});
