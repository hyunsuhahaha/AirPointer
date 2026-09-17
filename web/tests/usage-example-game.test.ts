import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTACKS, BEATS, CHAT_INPUT, CLICKS, CROP, DURATION, FIXED_ATTACK, GAP_TARGET, MIDDLE_TARGET, PIP_MANUAL_BUTTON, PROMPT_1, PROMPT_2, SEND_BUTTON,
  SNIP_RECT, STRIP_FRAMES, TAUNT_ATTACK, chatAt, chatInputAt, cursorAt, gameAt, pipAt, snipAt, stripSlots,
} from "../src/lib/usage-example-game.ts";

const near = (a: { x: number; y: number }, b: { x: number; y: number }, tolerance = 2) =>
  Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;

test("커서는 클릭하는 순간 해당 버튼 위에 있고, 자르기와 끌어다 놓기는 정해진 지점을 지난다", () => {
  const targets = new Map<number, { x: number; y: number }>([
    [BEATS.send1, SEND_BUTTON], [BEATS.manual, PIP_MANUAL_BUTTON], [BEATS.expand, GAP_TARGET],
    [BEATS.enlarge, MIDDLE_TARGET], [BEATS.send2, SEND_BUTTON],
  ]);
  for (const [at, target] of targets) assert.ok(near(cursorAt(at), target), `click at ${at}`);
  assert.ok(CLICKS.every((at, index) => index === 0 || at > CLICKS[index - 1]));
  assert.ok(near(cursorAt(BEATS.cropDrag[0]), CROP.start));
  assert.ok(near(cursorAt(BEATS.cropDrag[1]), CROP.end));
  const drop = cursorAt(BEATS.drag[1]);
  assert.ok(drop.x > CHAT_INPUT.x && drop.x < CHAT_INPUT.x + CHAT_INPUT.width && drop.y > CHAT_INPUT.y && drop.y < CHAT_INPUT.y + CHAT_INPUT.height);
  assert.equal(cursorAt(BEATS.drag[0] + 0.1).dragging, true);
  assert.equal(cursorAt(BEATS.drop + 0.1).dragging, false);
});

test("노란 네모는 수정 전 공격에만 뜨고, 머리와 태양은 말로 요청한 뒤 사라졌다가 해결되면 돌아온다", () => {
  const during = (at: number) => gameAt(at + 0.25);
  assert.equal(during(1).square, true);
  assert.equal(during(1).hair, true);
  assert.equal(during(1).sun, true);
  const baldAttack = ATTACKS.find((at) => at > BEATS.bald)!;
  assert.equal(during(baldAttack).square, true);
  assert.equal(during(baldAttack).hair, false);
  assert.equal(during(baldAttack).sun, false);
  assert.equal(during(FIXED_ATTACK).square, false);
  assert.equal(during(FIXED_ATTACK).slash, true);
  assert.equal(during(FIXED_ATTACK).hair, true);
  assert.equal(during(FIXED_ATTACK).sun, true);
  assert.equal(gameAt(0.2).square, false);
  assert.ok(gameAt(BEATS.baldZoom[0] + 1).zoom > 1.5);
  assert.equal(gameAt(BEATS.pip + 4).zoom, 1);
});

test("캡처하려 하면 화면이 멈춰 공격이 안 보이고, 캡처가 끝나자마자 네모가 뜬다", () => {
  const snip = BEATS.snip;
  assert.ok(snip.shortcut < snip.open && snip.open < snip.drag[0] && snip.drag[1] < snip.shot && snip.shot < snip.close && snip.close < snip.result[0]);
  assert.ok(snip.result[1] <= BEATS.prompt1[0]);
  for (let t = snip.open; t < snip.close; t += 0.05) {
    assert.equal(gameAt(t).square, false, `square during snip at ${t}`);
    assert.equal(gameAt(t).swing, null);
  }
  assert.ok(snip.attackKeys.every((at) => snipAt(at + 0.1).key === "attack" && snipAt(at + 0.1).overlay));
  assert.equal(snipAt(snip.shortcut + 0.1).key, "shortcut");
  // Every attack press lands while the game is frozen and marked as blocked.
  assert.ok(snip.attackKeys.length >= 5 && snip.attackKeys.every((at) => snipAt(at).blocked && gameAt(at + 0.1).swing === null));
  assert.equal(snipAt(snip.blocked[1] - 0.01).presses, snip.attackKeys.length);
  assert.ok(snip.catch22[0] > snip.result[1] && snip.catch22[1] <= BEATS.prompt1[0] && snipAt(snip.catch22[0] + 0.1).catch22);
  assert.equal(snipAt(snip.shot).flash, 1);
  assert.equal(snipAt(snip.result[0] + 0.1).result, true);
  assert.ok(TAUNT_ATTACK > snip.close && TAUNT_ATTACK < snip.result[1]);
  assert.equal(gameAt(TAUNT_ATTACK + 0.25).square, true);
  assert.ok(near(cursorAt(snip.drag[0]), SNIP_RECT.start) && near(cursorAt(snip.drag[1]), SNIP_RECT.end));
  assert.equal(cursorAt(snip.open + 0.5).crosshair, true);
  assert.equal(cursorAt(snip.close + 0.1).crosshair, false);
});

test("Manual 목록의 대표 화면에는 네모가 없고, 펼친 사이 화면에만 있다", () => {
  assert.ok(STRIP_FRAMES.representatives.every((frame) => !frame.square));
  assert.deepEqual(STRIP_FRAMES.gap.map((frame) => frame.square), [false, true]);
  assert.equal(stripSlots(false).filter((slot) => slot.kind === "middle").length, 0);
  const expanded = stripSlots(true);
  assert.deepEqual(expanded.map((slot) => slot.kind), ["card", "gap", "card", "middle", "middle", "gap", "card", "gap", "card"]);
  assert.equal(expanded.find((slot) => slot.kind === "gap" && slot.index === 1)?.expanded, true);
});

test("대화와 작은 창은 대본 순서대로 진행된다", () => {
  assert.equal(chatInputAt(BEATS.prompt1[1]).text, PROMPT_1);
  assert.equal(chatInputAt(BEATS.send1 + 0.01).text, "");
  assert.equal(chatInputAt(BEATS.drop + 0.01).attachment, true);
  assert.equal(chatInputAt(BEATS.prompt2[1]).text, PROMPT_2);
  assert.deepEqual(chatInputAt(BEATS.send2 + 0.01), { text: "", attachment: false });
  assert.deepEqual(chatAt(DURATION).map((message) => message.id), ["u1", "c1", "u2", "c2"]);
  assert.equal(chatAt(BEATS.reply1.thinking + 0.1).at(-1)?.role === "claudy" && (chatAt(BEATS.reply1.thinking + 0.1).at(-1) as { thinking: boolean }).thinking, true);
  const pip = [BEATS.pip, BEATS.manual, BEATS.expand, BEATS.enlarge, BEATS.cropMode, BEATS.cropped, BEATS.pipMinimize].map((at) => pipAt(at + 0.15));
  assert.deepEqual(pip.map((state) => [state.visible, state.manual, state.expanded, state.lightbox, state.cropMode, state.cropped, state.minimized]), [
    [true, false, false, false, false, false, false],
    [true, true, false, false, false, false, false],
    [true, true, true, false, false, false, false],
    [true, true, true, true, false, false, false],
    [true, true, true, true, true, false, false],
    [true, true, true, true, true, true, false],
    [true, true, true, false, true, true, true],
  ]);
});
