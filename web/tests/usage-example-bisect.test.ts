import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_STEPS, BEATS, BREAKING_EDIT, BREAK_SCREEN_SECONDS, CAPTIONS, CLICKS, COPY_BUTTON, DURATION, EDITS, EXPORT_BUTTON, FOLDER_PROMPT,
  QUICK_FOLDER, SOUND_CUES, TYPING, agentAt, clockLabel, cursorAt, pipAt, previewAt, rangeChip, timelineAt, timelineX,
} from "../src/lib/usage-example-bisect.ts";
import { INPUT_TARGET, SEND_BUTTON } from "../src/lib/usage-example-timeline.ts";

const near = (a: { x: number; y: number }, b: { x: number; y: number }, tolerance = 2) =>
  Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;

test("커서는 클릭하는 순간 해당 버튼 위에 있고, 클릭은 시간순이다", () => {
  const targets: [number, { x: number; y: number }][] = [
    [BEATS.taskSend, SEND_BUTTON], [BEATS.ask, SEND_BUTTON], [BEATS.quickFolder, QUICK_FOLDER], [BEATS.range, rangeChip(2)],
    [BEATS.exportClick, EXPORT_BUTTON], [BEATS.copy, COPY_BUTTON], [BEATS.agentClick, INPUT_TARGET],
  ];
  for (const [at, target] of targets) assert.ok(near(cursorAt(at), target), `click at ${at}`);
  assert.equal(targets.length, CLICKS.length);
  assert.ok(CLICKS.every((at, index) => index === 0 || at > CLICKS[index - 1]));
});

test("수정 12번이 5분 안에 시간순으로 일어나고, 7번째에서 버튼이 사라진다", () => {
  assert.equal(EDITS.length, 12);
  assert.ok(EDITS.every((edit, index) => index === 0 || (edit.t > EDITS[index - 1].t && edit.seconds > EDITS[index - 1].seconds)));
  assert.ok(EDITS.at(-1)!.seconds < 300);
  assert.equal(BREAKING_EDIT, 6);
  assert.equal(previewAt(EDITS[BREAKING_EDIT].t - 0.01).ctaVisible, true);
  assert.equal(previewAt(EDITS[BREAKING_EDIT].t + 0.01).ctaVisible, false);
  assert.equal(previewAt(BEATS.notice[0] + 0.1).ctaVisible, false);
  assert.equal(previewAt(BEATS.fixed + 0.1).ctaVisible, true);
  assert.equal(previewAt(BEATS.fixed + 0.1).edits, 12);
});

test("앞뒤 수정은 캡처 간격(1초)보다 멀어서 저장 시각으로 하나만 가리킨다", () => {
  const breakSave = EDITS[BREAKING_EDIT].seconds;
  assert.ok(BREAK_SCREEN_SECONDS - breakSave < 1);
  for (const [index, edit] of EDITS.entries()) {
    if (index !== BREAKING_EDIT) assert.ok(Math.abs(edit.seconds - breakSave) > 5, `edit ${index + 1}`);
  }
  assert.equal(clockLabel(breakSave), "14:03:40.9");
  assert.equal(clockLabel(BREAK_SCREEN_SECONDS), "14:03:41.2");
  // Neighbouring save markers do not overlap on the timeline.
  assert.ok(EDITS.every((edit, index) => index === 0 || timelineX(edit.seconds) - timelineX(EDITS[index - 1].seconds) >= 24));
});

test("에이전트는 기록을 읽은 뒤에야 저장 시각과 맞춘다", () => {
  assert.ok(BEATS.steps.every((at, index) => index === 0 || at > BEATS.steps[index - 1]));
  assert.equal(BEATS.steps.length, AGENT_STEPS.length);
  assert.ok(BEATS.steps[0] > BEATS.enter);
  assert.equal(BEATS.link, BEATS.steps[3]);
  assert.equal(timelineAt(BEATS.link - 0.01).link, false);
  assert.equal(timelineAt(BEATS.link).link, true);
  assert.ok(AGENT_STEPS[3].detail.includes("7번째"));
  assert.ok(FOLDER_PROMPT.includes("가입 버튼"));
  const end = agentAt(BEATS.summary[1]);
  assert.equal(end.running, false);
  assert.ok(end.lines.some((line) => line.kind === "summary" && line.text.includes("11개")));
  assert.equal(agentAt(BEATS.paste + 0.1).input, FOLDER_PROMPT);
});

test("PiP는 3번으로 열려 최근 5분을 저장하고, 보드 전에 사라진다", () => {
  assert.equal(pipAt(0).minimized, true);
  assert.equal(pipAt(BEATS.quickFolder).quickPressed, true);
  assert.equal(pipAt(BEATS.range + 0.1).range, 2);
  assert.ok(pipAt(BEATS.exporting[0] + 0.1).exporting !== null);
  assert.equal(pipAt(BEATS.exported).exported, true);
  assert.equal(pipAt(BEATS.pipMinimize + 0.1).minimized, true);
  assert.equal(pipAt(BEATS.board).visible, false);
});

test("처음엔 AI에게 부탁하는 문장을 직접 입력하고 보낸 뒤에 수정이 시작된다", () => {
  assert.equal(agentAt(BEATS.task[1]).input, "랜딩 페이지 좀 다듬어줘");
  assert.equal(agentAt(BEATS.task[1]).lines.length, 0);
  assert.ok(agentAt(BEATS.taskSend).lines.some((line) => line.kind === "user"));
  assert.equal(agentAt(BEATS.taskSend).input, "");
  assert.ok(EDITS[0].t > BEATS.taskSend);
  assert.ok(EDITS.at(-1)!.t < BEATS.notice[0]);
});

test("자막·소리·타이핑은 영상 길이 안에 있다", () => {
  assert.ok(CAPTIONS.every((caption, index) => caption.start < caption.end && caption.end <= DURATION && (index === 0 || caption.start >= CAPTIONS[index - 1].end)));
  assert.ok(SOUND_CUES.every((cue) => cue.at >= 0 && cue.at < DURATION));
  assert.ok(TYPING.every(([start, end]) => start < end && end <= DURATION));
  assert.doesNotThrow(() => { cursorAt(-0.02); previewAt(-0.02); agentAt(-0.02); pipAt(-0.02); });
});
