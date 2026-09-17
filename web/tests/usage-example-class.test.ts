import assert from "node:assert/strict";
import test from "node:test";
import {
  BEATS, CAPTIONS, CLICKS, COMMANDS, COPY_BUTTON, DURATION, NOTICE, PIP_EXPORT, QUESTIONS, QUICK_LINK, REACTIONS, SOUND_CUES, STUDENTS_TOTAL,
  TYPING, VIEWERS_MAX, chatAt, chatInputAt, cursorAt, pipAt, replayIndexAt, sharedAt, terminalAt, viewersAt,
} from "../src/lib/usage-example-class.ts";
import { INPUT_TARGET, SEND_BUTTON } from "../src/lib/usage-example-timeline.ts";

const near = (a: { x: number; y: number }, b: { x: number; y: number }, tolerance = 2) =>
  Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;

test("커서는 클릭하는 순간 해당 버튼 위에 있고, 클릭은 시간순이다", () => {
  const targets: [number, { x: number; y: number }][] = [
    [BEATS.reply, SEND_BUTTON], [BEATS.quickLink, QUICK_LINK], [BEATS.pipExport, PIP_EXPORT],
    [BEATS.copy, COPY_BUTTON], [BEATS.inputClick, INPUT_TARGET], [BEATS.send, SEND_BUTTON],
  ];
  for (const [at, target] of targets) assert.ok(near(cursorAt(at), target), `click at ${at}`);
  assert.equal(targets.length, CLICKS.length);
  assert.ok(CLICKS.every((at, index) => index === 0 || at > CLICKS[index - 1]));
});

test("명령어가 터미널에 쌓였다가 clear로 전부 사라진다", () => {
  const before = terminalAt(BEATS.cleared - 0.01).map((line) => line.text).join("\n");
  for (const command of COMMANDS) assert.ok(before.includes(command.cmd), command.cmd);
  const after = terminalAt(BEATS.cleared + 0.01);
  assert.equal(after.length, 1);
  assert.ok(terminalAt(BEATS.scroll[0] + 0.1).some((line) => line.kind === "hint"));
  assert.ok(COMMANDS.every((command, index) => index === 0 || command.typing[0] > COMMANDS[index - 1].outputAt));
});

test("clear 뒤에 질문이 쏟아지고, 한 줄 답장으로는 미답변이 줄지 않는다", () => {
  assert.ok(QUESTIONS.every((question) => question.at > BEATS.cleared));
  assert.equal(chatAt(QUESTIONS.at(-1)!.at).unanswered, QUESTIONS.length - 1);
  assert.equal(chatAt(BEATS.reply - 0.01).unanswered, QUESTIONS.filter((question) => question.at < BEATS.reply).length);
  assert.equal(chatInputAt(BEATS.replyTyping[1]).typing, true);
});

test("최근 3분 링크 하나를 공지하면 수강생 대부분이 같은 화면을 보고, 질문이 모두 해결된다", () => {
  assert.equal(pipAt(BEATS.quickLink).quickPressed, true);
  assert.deepEqual([pipAt(BEATS.pipExport).minimized, pipAt(BEATS.pipExport).link], [false, true]);
  assert.equal(chatInputAt(BEATS.paste + 0.01).text, NOTICE);
  const shared = chatAt(BEATS.send);
  assert.ok(shared.pinned && shared.entries.some((entry) => entry.kind === "notice"));
  assert.ok(sharedAt(BEATS.viewers[0]) && sharedAt(BEATS.replay[1]));
  assert.equal(viewersAt(BEATS.viewers[0]), 0);
  assert.equal(viewersAt(BEATS.viewers[1]), VIEWERS_MAX);
  assert.ok(VIEWERS_MAX <= STUDENTS_TOTAL);
  assert.equal(replayIndexAt(BEATS.replay[0]), 0);
  assert.equal(replayIndexAt(BEATS.replay[1]), COMMANDS.length - 1);
  assert.ok(REACTIONS.every((reaction) => reaction.at > BEATS.send && reaction.at < BEATS.shared[1]));
  const done = chatAt(BEATS.resolved);
  assert.equal(done.unanswered, 0);
  assert.ok(done.entries.filter((entry) => entry.kind === "student" && QUESTIONS.some((question) => question.id === entry.id)).every((entry) => entry.kind === "student" && entry.resolved));
  assert.equal(pipAt(BEATS.board).visible, false);
});

test("자막·소리·타이핑은 재생 시간 안에 있고 자막끼리 겹치지 않는다", () => {
  CAPTIONS.forEach((caption, index) => {
    assert.ok(caption.start < caption.end && caption.end <= DURATION);
    if (index > 0) assert.ok(caption.start >= CAPTIONS[index - 1].end);
  });
  assert.ok(SOUND_CUES.every((cue) => cue.at >= 0 && cue.at <= DURATION));
  assert.ok(TYPING.every(([start, end]) => start < end && end <= DURATION));
});
