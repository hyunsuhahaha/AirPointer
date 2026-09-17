import assert from "node:assert/strict";
import test from "node:test";
import {
  BEATS, CAPTIONS, CLICKS, COPY_BUTTON, DURATION, FLASH_SECONDS, LINK_URL, PIP_EXPORT, QUICK_LINK, REPLIES, SHARE_TEXT, SHOT_DELAY, SOUND_CUES,
  TYPING, VIEWERS, browserAt, captureAt, cardAt, chatAt, chatInputAt, cursorAt, navCenter, pipAt, sharedCardAt, viewersAt,
} from "../src/lib/usage-example-flash.ts";
import { SEND_BUTTON } from "../src/lib/usage-example-timeline.ts";

const near = (a: { x: number; y: number }, b: { x: number; y: number }, tolerance = 2) =>
  Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;

test("커서는 클릭하는 순간 해당 메뉴·버튼 위에 있고, 클릭은 시간순이다", () => {
  const targets: [number, { x: number; y: number }][] = [
    ...BEATS.navs.map(([at, page]) => [at, navCenter(page)] as [number, { x: number; y: number }]),
    [BEATS.send1, SEND_BUTTON], [BEATS.send2, SEND_BUTTON], [BEATS.quickLink, QUICK_LINK],
    [BEATS.pipExport, PIP_EXPORT], [BEATS.copy, COPY_BUTTON], [BEATS.send3, SEND_BUTTON],
  ];
  for (const [at, target] of targets) assert.ok(near(cursorAt(at), target), `click at ${at}`);
  assert.equal(targets.length, CLICKS.length);
  assert.ok(CLICKS.every((at, index) => index === 0 || at > CLICKS[index - 1]));
});

test("페이지를 넘길 때만 짧게 번쩍이고, 캡처는 늘 번쩍임이 끝난 뒤에 찍힌다", () => {
  for (const at of BEATS.flashes) {
    assert.ok(browserAt(at + 0.05).flash > 0);
    assert.equal(browserAt(at + FLASH_SECONDS + 0.01).flash, 0);
  }
  for (const snip of BEATS.snips) {
    const shot = snip + SHOT_DELAY;
    assert.ok(BEATS.flashes.every((at) => shot < at || shot > at + FLASH_SECONDS), `snip at ${snip} catches a flash`);
    assert.equal(captureAt(shot + 0.1).missed, true);
  }
  // After the fix, page changes no longer flash.
  for (const [at] of BEATS.navs.filter(([at]) => at > BEATS.deployed)) assert.equal(browserAt(at + 0.1).flash, 0);
});

test("링크 하나를 올리면 팀원 세 명이 차례로 같은 화면을 연다", () => {
  assert.equal(chatInputAt(BEATS.pasted + 0.01).text, SHARE_TEXT);
  assert.ok(SHARE_TEXT.includes(LINK_URL));
  assert.equal(viewersAt(BEATS.send3).length, 0);
  assert.deepEqual(VIEWERS.map((viewer) => viewer.author), ["minjun", "seoyeon", "jiho"]);
  assert.ok(VIEWERS.every((viewer, index) => viewer.at > BEATS.send3 && (index === 0 || viewer.at > VIEWERS[index - 1].at)));
  for (const viewer of VIEWERS) assert.ok(sharedCardAt(viewer.at), `shared card hidden when ${viewer.author} opens it`);
  const shared = chatAt(VIEWERS.at(-1)!.at).messages.find((message) => message.id === "m3");
  assert.ok(shared && shared.kind === "text" && shared.views === 3);
  // The PM and QA react to the same screen before the developer's AI answers.
  const reactions = REPLIES.filter((reply) => reply.author !== "minjun");
  assert.ok(reactions.length === 2 && reactions.every((reply) => reply.at > BEATS.send3 && reply.at < BEATS.analysis.card));
});

test("개발자는 못 봤다고 하다가, 같은 링크를 AI에게 넘겨 원인을 찾고 배포한다", () => {
  assert.equal(cardAt(REPLIES[2].at + 0.1), "dumb");
  assert.equal(cardAt(BEATS.analysis.card + 0.1), "smart");
  assert.equal(pipAt(BEATS.quickLink).quickPressed, true);
  assert.deepEqual([pipAt(BEATS.pipExport).minimized, pipAt(BEATS.pipExport).link], [false, true]);
  assert.equal(pipAt(BEATS.send3).minimized, true);
  const final = chatAt(DURATION).messages;
  const analysis = final.find((message) => message.kind === "analysis");
  assert.ok(analysis && analysis.kind === "analysis" && analysis.evidence && analysis.tools.length === 3 && analysis.done.includes("<head>"));
  assert.ok(final.findIndex((message) => message.id === "d4") < final.indexOf(analysis));
  assert.equal(browserAt(BEATS.deployed).fixed, true);
  assert.equal(chatAt(DURATION).typing, null);
});

test("자막·소리·타이핑은 재생 시간 안에 있고 자막끼리 겹치지 않는다", () => {
  CAPTIONS.forEach((caption, index) => {
    assert.ok(caption.start < caption.end && caption.end <= DURATION);
    if (index > 0) assert.ok(caption.start >= CAPTIONS[index - 1].end);
  });
  assert.ok(CAPTIONS.some((caption) => caption.text.includes("팀 전원")));
  assert.ok(SOUND_CUES.every((cue) => cue.at >= 0 && cue.at <= DURATION));
  assert.ok(TYPING.every(([start, end]) => start < end && end <= DURATION));
});
