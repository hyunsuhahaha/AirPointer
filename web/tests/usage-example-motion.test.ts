import assert from "node:assert/strict";
import test from "node:test";
import {
  BEATS, CAPTIONS, CLICKS, DURATION, GAP_TARGET, PHONE_REF, PICKS, PICK_SOURCES, QUICK_MANUAL, SOUND_CUES, TYPING,
  backTarget, cardRect, cardTarget, chatAt, cursorAt, frameProgress, inputAt, manualAt, mineAt, refProgressAt, stripSlots,
} from "../src/lib/usage-example-motion.ts";
import { INPUT_TARGET, SEND_BUTTON } from "../src/lib/usage-example-timeline.ts";

const near = (a: { x: number; y: number }, b: { x: number; y: number }, tolerance = 2) =>
  Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;

test("커서는 클릭·드래그하는 순간 해당 위치에 있고, 클릭은 시간순이다", () => {
  const targets: [number, { x: number; y: number }][] = [
    [BEATS.refTaps[0], cardTarget(PHONE_REF)], [BEATS.refBacks[0], backTarget(PHONE_REF)], [BEATS.refTaps[1], cardTarget(PHONE_REF)],
    [BEATS.refBacks[1], backTarget(PHONE_REF)], [BEATS.describeClick, INPUT_TARGET], [BEATS.send1, SEND_BUTTON],
    [BEATS.quickManual, QUICK_MANUAL],
    [BEATS.gap, GAP_TARGET], [BEATS.send2, SEND_BUTTON],
  ];
  for (const [at, target] of targets) assert.ok(near(cursorAt(at), target), `click at ${at}`);
  assert.equal(targets.length, CLICKS.length);
  assert.ok(CLICKS.every((at, index) => index === 0 || at > CLICKS[index - 1]));
  BEATS.drags.forEach(([start, end], index) => {
    assert.ok(near(cursorAt(start), PICK_SOURCES[index]), `drag ${index} start`);
    assert.ok(near(cursorAt(end), INPUT_TARGET), `drag ${index} end`);
    assert.equal(cursorAt((start + end) / 2).pressed, true);
  });
});

test("레퍼런스 카드는 0.4초에 ease-out으로 화면 전체까지 펼쳐진다", () => {
  const tap = BEATS.refTaps[0];
  assert.equal(refProgressAt(tap - 0.01), 0);
  assert.ok(refProgressAt(tap + 0.2) > 0.85);
  assert.equal(refProgressAt(tap + 0.4), 1);
  assert.deepEqual(cardRect(1), { x: 0, y: 0, width: 220, height: 420, radius: 0 });
  assert.equal(refProgressAt(BEATS.refBacks[0] + 0.4), 0);
});

test("말로 설명한 첫 결과는 다른 움직임이고, 영상 첨부는 거절된다", () => {
  assert.deepEqual(mineAt(BEATS.reply1.done - 0.01).kind, "idle");
  // The wrong result plays twice, in step with the reference, but differs.
  const [from, to] = BEATS.wrongCompare;
  let opens = 0;
  for (let at = from; at < to; at += 0.05) {
    const mine = mineAt(at);
    assert.equal(mine.kind, "wrong");
    assert.equal(mine.progress, refProgressAt(at));
    if (mine.progress === 1 && mineAt(at - 0.05).progress < 1) opens++;
  }
  assert.equal(opens, 2);
  assert.ok(inputAt(BEATS.videoPaste + 0.1).video);
  assert.equal(chatAt(BEATS.videoRejected[1]).length, 2);
});

test("사이 화면을 펼쳐 시작·중간·끝 3장을 순서대로 넣으면, AI가 같은 전환을 만든다", () => {
  assert.ok(stripSlots(false).every((slot) => slot.kind !== "middle"));
  assert.equal(stripSlots(true).filter((slot) => slot.kind === "middle").length, 3);
  assert.deepEqual(PICKS.map((id) => frameProgress(id) > 0.5), [false, true, true]);
  assert.ok(frameProgress("m2") < 1 && frameProgress("r2") === 1);
  BEATS.drags.forEach(([, end], index) => assert.equal(manualAt(end).picked.length, index + 1));
  assert.deepEqual(inputAt(BEATS.prompt[1]).frames, [...PICKS]);
  const answer = chatAt(DURATION).at(-1)!;
  assert.ok(answer.role === "claudy" && answer.code && answer.tools.length === 3);
  const [start] = BEATS.compare;
  for (let at = start; at < BEATS.board; at += 0.05) assert.equal(mineAt(at).progress, refProgressAt(at), `lockstep at ${at}`);
  assert.equal(mineAt(start).kind, "right");
});

test("자막·소리·타이핑은 재생 시간 안에 있고 자막끼리 겹치지 않는다", () => {
  CAPTIONS.forEach((caption, index) => {
    assert.ok(caption.start < caption.end && caption.end <= DURATION);
    if (index > 0) assert.ok(caption.start >= CAPTIONS[index - 1].end);
  });
  assert.ok(SOUND_CUES.every((cue) => cue.at >= 0 && cue.at <= DURATION));
  assert.ok(TYPING.every(([start, end]) => start < end && end <= DURATION));
});
