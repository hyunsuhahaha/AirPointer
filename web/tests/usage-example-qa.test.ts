import assert from "node:assert/strict";
import test from "node:test";
import {
  AFTER_SECONDS, BEATS, BEFORE_SECONDS, CAPTIONS, CLICKS, COMPARISON, COPY_BUTTON, COUPON_BUTTON, DURATION, MODAL_SAVE, PIP_EXPORT, QUESTIONS,
  QUICK_LINK, REPRO_FIELD, SHIP_BUTTON, SOUND_CUES, STEPS, SUBMIT, TITLE_FIELD, TYPE_SPAN, TYPING, boardRowsAt, captureAt, clockAt, cursorAt,
  calloutAt, discountFor, phaseAt, pipAt, shopAt, totalFor, trackerAt,
} from "../src/lib/usage-example-qa.ts";
import { SEND_BUTTON } from "../src/lib/usage-example-timeline.ts";

const near = (a: { x: number; y: number }, b: { x: number; y: number }, tolerance = 2) =>
  Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;

test("커서는 클릭하는 순간 해당 버튼·입력칸 위에 있고, 클릭은 시간순이다", () => {
  const targets: [number, { x: number; y: number }][] = [
    [BEATS.couponClick, COUPON_BUTTON], [BEATS.shipClick, SHIP_BUTTON], [BEATS.modalSave, MODAL_SAVE], [BEATS.submit1, SUBMIT],
    [BEATS.send1, SEND_BUTTON], [BEATS.quickLink, QUICK_LINK], [BEATS.pipExport, PIP_EXPORT], [BEATS.copy, COPY_BUTTON],
    [BEATS.titleClick, TITLE_FIELD], [BEATS.reproClick, REPRO_FIELD], [BEATS.submit2, SUBMIT],
  ];
  for (const [at, target] of targets) assert.ok(near(cursorAt(at), target), `click at ${at}`);
  assert.equal(targets.length, CLICKS.length);
  assert.ok(CLICKS.every((at, index) => index === 0 || at > CLICKS[index - 1]));
});

test("버그는 쿠폰 적용 후 배송지를 바꾸면 할인이 풀리는 것이다", () => {
  assert.equal(totalFor(shopAt(BEATS.couponClick + 0.1)), "39,200원");
  assert.equal(shopAt(BEATS.shipClick + 0.1), "modal");
  assert.equal(totalFor(shopAt(BEATS.modalSave + 0.1)), "49,000원");
  // The discount visibly disappears and the bug is spelled out for a few seconds.
  assert.equal(discountFor(shopAt(BEATS.couponClick + 0.1)), "−9,800원");
  assert.equal(discountFor(shopAt(BEATS.modalSave + 0.1)), "0원");
  assert.ok(!calloutAt(BEATS.modalSave) && calloutAt(BEATS.modalSave + 0.2));
  assert.ok(BEATS.steps[0] - BEATS.modalSave >= 3);
  assert.equal(calloutAt(BEATS.steps[0]), false);
});

test("기존 방식은 단계마다 캡처·붙여넣기·설명을 반복하고, 등록 뒤에도 질문이 두 번 온다", () => {
  const form = trackerAt(BEATS.environment[1]);
  assert.ok(form.mode === "form" && form.issue === "before");
  assert.equal(form.steps.length, STEPS.length);
  assert.ok(form.steps.every((step, index) => step.text === `${index + 1}. ${STEPS[index]}` && step.shot !== null));
  BEATS.steps.forEach((at, index) => {
    // The screen being captured matches the step being written.
    assert.equal(shopAt(at + 0.1), form.steps[index].shot);
    if (index > 0) assert.ok(at >= BEATS.steps[index - 1] + TYPE_SPAN[1]);
  });
  assert.deepEqual([captureAt(BEATS.submit1).shots, captureAt(BEATS.submit1).steps], [6, 6]);
  const issue = trackerAt(BEATS.transition[0] - 0.01);
  assert.ok(issue.mode === "issue" && issue.issue === "before");
  assert.equal(issue.comments.filter((comment) => comment.kind === "person" && comment.author === "minjun").length, QUESTIONS.length);
  assert.equal(issue.status, "재현 대기");
  assert.equal(clockAt(QUESTIONS[1].at), BEFORE_SECONDS);
});

test("새 방식은 제목과 기록 링크만으로 12초 안에 등록되고, AI가 재현을 확인해 해결된다", () => {
  assert.equal(phaseAt(BEATS.transition[0] + 0.1), "transition");
  assert.equal(trackerAt(BEATS.transition[0] + 0.1).mode, "blank");
  assert.equal(clockAt(BEATS.transition[1]), 0);
  assert.equal(pipAt(BEATS.quickLink).quickPressed, true);
  assert.deepEqual([pipAt(BEATS.pipExport).minimized, pipAt(BEATS.pipExport).link], [false, true]);
  const form = trackerAt(BEATS.pasteLink + 0.05);
  assert.ok(form.mode === "form" && form.issue === "after" && form.link);
  assert.equal(clockAt(BEATS.submit2), AFTER_SECONDS);
  const issue = trackerAt(DURATION);
  assert.ok(issue.mode === "issue" && issue.issue === "after" && issue.status === "해결됨");
  const analysis = issue.comments[0];
  assert.ok(analysis.kind === "analysis" && analysis.evidence && analysis.tools.length === 3);
  assert.ok(issue.comments.every((comment) => comment.kind !== "person" || !comment.text.includes("?")));
  assert.equal(pipAt(BEATS.board).visible, false);
});

test("비교 보드는 기존 방식과 새 방식을 한 줄씩 보여준다", () => {
  assert.equal(boardRowsAt(BEATS.board - 0.01), 0);
  assert.equal(boardRowsAt(DURATION), COMPARISON.length);
  assert.deepEqual(COMPARISON[0], { label: "이슈 작성 시간", before: "18:40", after: "00:12" });
});

test("자막·소리·타이핑은 재생 시간 안에 있고 자막끼리 겹치지 않는다", () => {
  CAPTIONS.forEach((caption, index) => {
    assert.ok(caption.start < caption.end && caption.end <= DURATION);
    if (index > 0) assert.ok(caption.start >= CAPTIONS[index - 1].end);
  });
  assert.ok(SOUND_CUES.every((cue) => cue.at >= 0 && cue.at <= DURATION));
  assert.ok(TYPING.every(([start, end]) => start < end && end <= DURATION));
});
