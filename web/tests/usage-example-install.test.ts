import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_STEPS, BEATS, CAPTIONS, CLICKS, COPY_BUTTON, DURATION, EXPORT_BUTTON, FOLDER_PROMPT, FRAMES_SAVED, INSTALL, QUICK_FOLDER, SOUND_CUES,
  TYPING, agentAt, cursorAt, pipAt, rangeChip, snipAt, terminalAt, webChatAt,
} from "../src/lib/usage-example-install.ts";
import { INPUT_TARGET, SEND_BUTTON } from "../src/lib/usage-example-timeline.ts";

const near = (a: { x: number; y: number }, b: { x: number; y: number }, tolerance = 2) =>
  Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;

test("커서는 클릭하는 순간 해당 버튼 위에 있고, 클릭은 시간순이다", () => {
  const targets: [number, { x: number; y: number }][] = [
    [BEATS.webSend, SEND_BUTTON], [BEATS.quickFolder, QUICK_FOLDER], [BEATS.range, rangeChip(1)],
    [BEATS.exportClick, EXPORT_BUTTON], [BEATS.copy, COPY_BUTTON], [BEATS.agentClick, INPUT_TARGET],
  ];
  for (const [at, target] of targets) assert.ok(near(cursorAt(at), target), `click at ${at}`);
  assert.equal(targets.length, CLICKS.length);
  assert.ok(CLICKS.every((at, index) => index === 0 || at > CLICKS[index - 1]));
});

test("1분 12초의 경고는 설치가 끝날 때쯤 이미 화면 밖으로 밀려나 있다", () => {
  const warningStep = INSTALL.find((step) => step.out.some((line) => line.kind === "warn"))!;
  assert.equal(warningStep.clock, "01:12");
  assert.equal(terminalAt(warningStep.at + 0.3).warningVisible, true);
  const end = terminalAt(BEATS.install[1]);
  assert.equal(end.warningVisible, false);
  assert.equal(end.lines.at(-1)!.kind, "err");
  assert.equal(end.clock, "03:00");
  assert.ok(terminalAt(BEATS.scrollUp[0] + 0.1).scrolledHint);
});

test("캡처 도구는 지금 화면 한 장만 찍고, 웹 AI는 그 한 장으로 추측한다", () => {
  assert.ok(snipAt(BEATS.snip + 0.1).keys);
  assert.equal(webChatAt(BEATS.paste + 0.05).attached, 1);
  const [question, answer] = webChatAt(BEATS.webReply.done).messages;
  assert.equal(question.images, 1);
  assert.ok(answer.role === "ai" && !answer.text.includes("80 is already in use") && answer.done);
});

test("Local Folder로 3분을 저장하면 로컬 에이전트가 경고를 찾아 내 PC 설정을 고친다", () => {
  assert.equal(FRAMES_SAVED, 180);
  const pip = pipAt(BEATS.exportClick);
  assert.ok(pip.folder && !pip.minimized && pip.range === 1);
  assert.ok(pipAt(BEATS.exporting[0] + 0.1).exporting !== null && pipAt(BEATS.exported).exported);
  assert.equal(agentAt(BEATS.promptPaste + 0.05).input, FOLDER_PROMPT);
  assert.equal(BEATS.steps.length, AGENT_STEPS.length);
  const done = agentAt(DURATION);
  assert.equal(done.steps.length, AGENT_STEPS.length);
  const kinds = done.steps.map((step) => step.kind);
  assert.ok(kinds.indexOf("find") < kinds.indexOf("local") && kinds.indexOf("local") < kinds.indexOf("edit") && kinds.at(-1) === "ok");
  assert.ok(done.sentNothing && done.summary.includes("1분 12초"));
  assert.equal(terminalAt(BEATS.rerun[1]).lines.at(-1)!.kind, "ok");
});

test("자막·소리·타이핑은 재생 시간 안에 있고 자막끼리 겹치지 않는다", () => {
  CAPTIONS.forEach((caption, index) => {
    assert.ok(caption.start < caption.end && caption.end <= DURATION);
    if (index > 0) assert.ok(caption.start >= CAPTIONS[index - 1].end);
  });
  assert.ok(SOUND_CUES.every((cue) => cue.at >= 0 && cue.at <= DURATION));
  assert.ok(TYPING.every(([start, end]) => start < end && end <= DURATION));
});
