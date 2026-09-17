import assert from "node:assert/strict";
import test from "node:test";
import {
  BEATS, CAPTIONS, CLICKS, CONSOLE_TAB, COPY_BUTTON, DURATION, EXPORT_BUTTON, LINK_PROMPT, NETWORK_TAB, PIP_EXPORT, PROMPT_1, QUICK_LINK,
  ROUNDS, SAVE_BUTTON, SOUND_CUES, TOAST, TYPING, VERDICT, WORK, appAt, browserAt, captureAt, chatAt, chatInputAt, cursorAt, editorAt, pipAt,
} from "../src/lib/usage-example-toast.ts";
import { SEND_BUTTON } from "../src/lib/usage-example-timeline.ts";

const near = (a: { x: number; y: number }, b: { x: number; y: number }, tolerance = 2) =>
  Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;

test("커서는 클릭하는 순간 해당 버튼 위에 있고, 클릭은 시간순이다", () => {
  const targets: [number, { x: number; y: number }][] = [
    [BEATS.saveClick, SAVE_BUTTON], ...BEATS.deadClicks.map((at) => [at, EXPORT_BUTTON] as [number, typeof EXPORT_BUTTON]),
    [BEATS.networkCheck, NETWORK_TAB], [BEATS.deadClickNetwork, EXPORT_BUTTON], [BEATS.send1, SEND_BUTTON],
    ...ROUNDS.map((round) => [round.send, SEND_BUTTON] as [number, typeof SEND_BUTTON]),
    [BEATS.consoleTab, CONSOLE_TAB], [BEATS.networkTab, NETWORK_TAB], [BEATS.quickLink, QUICK_LINK],
    [BEATS.pipExport, PIP_EXPORT], [BEATS.copy, COPY_BUTTON], [BEATS.send6, SEND_BUTTON], [BEATS.exportWorks, EXPORT_BUTTON],
  ];
  for (const [at, target] of targets) assert.ok(near(cursorAt(at), target), `click at ${at}`);
  assert.equal(targets.length, CLICKS.length);
  assert.ok(CLICKS.every((at, index) => index === 0 || at > CLICKS[index - 1]));
});

test("저장 토스트는 내보내기 버튼을 덮고, 사라진 뒤에도 수정 전까지 남아 클릭을 막는다", () => {
  const button = { x: EXPORT_BUTTON.x - WORK.x, y: EXPORT_BUTTON.y - WORK.y };
  assert.ok(button.x > TOAST.x && button.x < TOAST.x + TOAST.width && button.y > TOAST.y && button.y < TOAST.y + TOAST.height);
  assert.equal(browserAt(BEATS.toast[0] + 0.1).toastOpacity, 1);
  for (const at of BEATS.deadClicks) {
    const state = browserAt(at);
    assert.equal(state.toastOpacity, 0);
    assert.equal(state.toastGhost, true);
  }
  // The dead clicks last a while: slow ones, a puzzled pause, then a burst.
  const clicks = BEATS.deadClicks;
  assert.ok(clicks.length >= 10 && clicks.at(-1)! - clicks[0] >= 2.5);
  assert.ok(BEATS.puzzled[0] > clicks[2] && BEATS.puzzled[1] < clicks[3]);
  assert.equal(browserAt(clicks.at(-1)!).deadClicks, clicks.length);
  assert.ok(browserAt(clicks.at(-1)! + 0.05).deadPops.length >= 2);
  assert.equal(browserAt(BEATS.devtools).deadClicks, 0);
  assert.equal(browserAt(BEATS.exportWorks).toastGhost, false);
  assert.equal(browserAt(BEATS.exportWorks - 0.01).exportRequest, false);
  assert.equal(browserAt(BEATS.downloaded).downloaded, true);
});

test("개발자는 원인 범위를 먼저 좁혀 말하고, 캡처에는 토스트가 한 번도 찍히지 않는다", () => {
  assert.ok(BEATS.devtools < BEATS.prompt1[0] && BEATS.deadClickNetwork < BEATS.prompt1[0]);
  for (const phrase of ["onClick", "콘솔 에러 0", "요청 0", "저장 누른 다음"]) assert.ok(PROMPT_1.includes(phrase));
  for (const round of ROUNDS) assert.equal(browserAt(round.snip).toastOpacity, 0);
  // The AI asks for what was already said, and ends with "works on my machine".
  assert.deepEqual(ROUNDS.map((round) => round.shot), ["page", "console", "network", "code"]);
  const verdict = chatAt(VERDICT.text[1]).at(-1)!;
  assert.ok(verdict.role === "claudy" && verdict.text.includes("제 환경에서는 정상 작동합니다"));
  for (let at = VERDICT.text[0]; at <= VERDICT.text[1]; at += 0.01) {
    const text = chatAt(at).at(-1)!.text;
    assert.ok(!/[\uD800-\uDBFF]$/.test(text), `half an emoji at ${at}`);
  }
  assert.equal(captureAt(VERDICT.text[0]).pasted, 4);
  assert.equal(captureAt(VERDICT.text[0]).minutes, 14);
});

test("라운드마다 캡처를 붙여넣은 입력창이 보내진 메시지로 바뀐다", () => {
  ROUNDS.forEach((round, index) => {
    assert.ok(round.thinking < round.text[0] && round.text[1] < round.snip && round.snip < round.paste && round.noteTyping[1] < round.send);
    if (index > 0) assert.ok(round.thinking > ROUNDS[index - 1].send);
    assert.deepEqual(chatInputAt(round.noteTyping[1]), { text: round.note, shot: round.shot, typing: true });
    const sent = chatAt(round.send).find((message) => message.id === `u${index + 2}`);
    assert.ok(sent && sent.role === "user" && sent.shot === round.shot);
  });
  assert.equal(appAt(ROUNDS[3].snip), "editor");
  assert.equal(browserAt(ROUNDS[1].snip).devtoolsTab, "console");
  assert.equal(browserAt(ROUNDS[2].snip).devtoolsTab, "network");
});

test("최소화 막대의 2번으로 링크를 만들고, 링크만 보내면 AI가 저장 직후 화면을 짚어 고친다", () => {
  assert.deepEqual([pipAt(BEATS.pip).minimized, pipAt(BEATS.pip).link], [true, false]);
  assert.equal(pipAt(BEATS.quickLink).quickPressed, true);
  assert.deepEqual([pipAt(BEATS.pipExport).minimized, pipAt(BEATS.pipExport).link], [false, true]);
  assert.equal(chatInputAt(BEATS.pasted + 0.01).text, LINK_PROMPT);
  assert.equal(pipAt(BEATS.send6).minimized, true);
  const answer = chatAt(DURATION).at(-1)!;
  assert.ok(answer.role === "claudy" && answer.evidence && answer.tools.length === 3);
  assert.ok(answer.text.includes("토스트") && answer.done.includes("pointer-events: none"));
  assert.equal(appAt(BEATS.diff[0]), "editor");
  assert.equal(editorAt(BEATS.diff[1]).diffRows, 4);
  assert.equal(appAt(BEATS.exportWorks), "browser");
});

test("자막·소리·타이핑은 재생 시간 안에 있고 자막끼리 겹치지 않는다", () => {
  CAPTIONS.forEach((caption, index) => {
    assert.ok(caption.start < caption.end && caption.end <= DURATION);
    if (index > 0) assert.ok(caption.start >= CAPTIONS[index - 1].end);
  });
  assert.ok(SOUND_CUES.every((cue) => cue.at >= 0 && cue.at <= DURATION));
  assert.ok(TYPING.every(([start, end]) => start < end && end <= DURATION));
  assert.equal(appAt(-0.01), "browser");
});
