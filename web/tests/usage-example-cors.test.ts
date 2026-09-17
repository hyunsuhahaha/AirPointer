import assert from "node:assert/strict";
import test from "node:test";
import {
  BEATS, CAPTIONS, CLICKS, CONSOLE_TAB, COPY_BUTTON, DURATION, ERROR_LINE, EXPORT_BUTTON, HEADERS_CLOSE, LINK_PROMPT, NETWORK_TAB,
  PROMPT_1, QUICK_LINK, REQUEST_URL, SOUND_CUES, TYPING, USERS_ROW, appAt, browserAt, chatAt, chatInputAt, cursorAt, editorAt, pipAt,
} from "../src/lib/usage-example-cors.ts";
import { SEND_BUTTON } from "../src/lib/usage-example-timeline.ts";

const near = (a: { x: number; y: number }, b: { x: number; y: number }, tolerance = 2) =>
  Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;

test("커서는 클릭하는 순간 해당 버튼 위에 있고, 클릭은 시간순이다", () => {
  const targets = new Map<number, { x: number; y: number }>([
    [BEATS.networkTab, NETWORK_TAB], [BEATS.usersRow, USERS_ROW], [BEATS.headersOpen[1], HEADERS_CLOSE], [BEATS.consoleTab, CONSOLE_TAB],
    [BEATS.selectError, ERROR_LINE], [BEATS.send1, SEND_BUTTON], [BEATS.send2, SEND_BUTTON], [BEATS.quickLink, QUICK_LINK],
    [BEATS.exportClick, EXPORT_BUTTON], [BEATS.copy, COPY_BUTTON], [BEATS.send3, SEND_BUTTON],
  ]);
  for (const [at, target] of targets) assert.ok(near(cursorAt(at), target), `click at ${at}`);
  assert.equal(targets.size, CLICKS.length);
  assert.ok(CLICKS.every((at, index) => index === 0 || at > CLICKS[index - 1]));
});

test("개발자는 404·HTML 응답·CORS 설정까지 짚어 말하고, 결정적 단서만 1초 안에 스쳐 지나간다", () => {
  for (const at of [BEATS.networkTab, BEATS.usersRow, BEATS.consoleTab, BEATS.selectError]) assert.equal(appAt(at), "browser");
  assert.equal(appAt(-0.01), "editor");
  for (const phrase of ["404", "HTML", "CORS는 이미 열어둠"]) assert.ok(PROMPT_1.includes(phrase));
  const [open, close] = BEATS.headersOpen;
  assert.ok(close - open <= 1);
  assert.equal(browserAt(open + 0.1).headersOpen, true);
  assert.equal(browserAt(open + 0.1).devtoolsTab, "network");
  assert.equal(browserAt(close + 0.05).headersOpen, false);
  assert.ok(REQUEST_URL.includes("/undefined/"));
  for (const message of chatAt(BEATS.reply2.done + 1)) assert.ok(!message.text.includes("undefined"));
});

test("AI의 CORS 수정 뒤에도 같은 에러가 나고, 원인을 고친 뒤에만 목록이 뜬다", () => {
  const [, reload2, reload3, fix] = BEATS.reloads;
  assert.equal(browserAt(BEATS.reloads[0] + 0.4).page, "error");
  assert.ok(reload2 > BEATS.reply1.done && browserAt(reload2 + 0.4).page === "error");
  assert.ok(reload3 > BEATS.reply2.done && browserAt(reload3 + 0.4).page === "error");
  assert.equal(browserAt(reload3 + 0.4).consoleError, true);
  assert.ok(fix > BEATS.diff[1]);
  assert.equal(browserAt(fix + 0.4).page, "loaded");
  assert.equal(browserAt(fix + 0.4).consoleError, false);
  assert.equal(browserAt(DURATION).requestStatus, 200);
  for (const at of [fix, reload2, reload3]) assert.equal(appAt(at), "browser");
  assert.equal(appAt(BEATS.diff[0]), "editor");
});

test("AI가 넣은 설정 파일은 탭으로 쌓였다가 되돌리기와 함께 사라진다", () => {
  assert.deepEqual(editorAt(BEATS.reply1.done - 0.1).tabs, ["users.tsx"]);
  assert.deepEqual(editorAt(BEATS.reply2.done + 0.1).tabs, ["users.tsx", "server.ts", "cors.ts", "next.config.js"]);
  assert.equal(editorAt(BEATS.diff[0]).active, "변경 사항");
  assert.equal(editorAt(BEATS.diff[1]).diffRows, 7);
  assert.deepEqual(editorAt(BEATS.diff[1] + 0.1).tabs, ["users.tsx", ".env", "변경 사항"]);
  assert.ok(editorAt(BEATS.restarts[1][1]).terminal.some((line) => line.includes("재시작 4번째")));
  assert.equal(editorAt(0).saved, false);
  assert.equal(editorAt(BEATS.save).saved, true);
});

test("최소화 막대의 2번이 Agent Link를 열고, 링크 프롬프트만 붙여넣어 보낸다", () => {
  assert.equal(pipAt(BEATS.pip - 0.01).visible, false);
  assert.deepEqual([pipAt(BEATS.pip).minimized, pipAt(BEATS.pip).link], [true, false]);
  assert.equal(pipAt(BEATS.quickLink).quickPressed, true);
  assert.deepEqual([pipAt(BEATS.exportClick).minimized, pipAt(BEATS.exportClick).link], [false, true]);
  assert.equal(pipAt(BEATS.exporting[0] + 0.1).exporting, true);
  assert.equal(pipAt(BEATS.copy + 0.1).copied, true);
  assert.equal(pipAt(BEATS.send3).minimized, true);
  assert.equal(chatInputAt(BEATS.pasted + 0.01).text, LINK_PROMPT);
  assert.equal(chatInputAt(BEATS.send3 + 0.01).text, "");
});

test("세 번째 답에서만 링크를 읽고 Network 화면을 근거로 짚는다", () => {
  const before = chatAt(BEATS.reply3.text[1] - 0.01).find((message) => message.id === "c3");
  assert.ok(before && before.role === "claudy" && !before.evidence);
  const final = chatAt(DURATION);
  assert.deepEqual(final.map((message) => message.id), ["u1", "c1", "u2", "c2", "u3", "c3"]);
  const answer = final.at(-1)!;
  assert.ok(answer.role === "claudy" && answer.evidence && answer.tools.length === 3);
  assert.ok(answer.text.includes(REQUEST_URL) && answer.done.includes("NEXT_PUBLIC_"));
  for (const message of final.slice(0, 4)) if (message.role === "claudy") assert.ok(message.text.includes("CORS") || message.text.includes("Access-Control"));
});

test("자막·소리·타이핑은 재생 시간 안에 있고 자막끼리 겹치지 않는다", () => {
  CAPTIONS.forEach((caption, index) => {
    assert.ok(caption.start < caption.end && caption.end <= DURATION);
    if (index > 0) assert.ok(caption.start >= CAPTIONS[index - 1].end);
  });
  assert.ok(SOUND_CUES.every((cue) => cue.at >= 0 && cue.at <= DURATION));
  assert.ok(TYPING.every(([start, end]) => start < end && end <= DURATION));
});
