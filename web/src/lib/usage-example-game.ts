// Script for usage example 01 (game development): a sword attack flashes a
// stray yellow square, a screenshot attempt misses it, so the user explains it
// in words and the AI "fixes" it by deleting everything else that is yellow
// (the hero's hair, the sun, even the window's yellow button); the Manual
// picker then hands it the exact frame instead. Everything is a
// pure function of the playhead `t` (seconds) on a 1280×720 stage.

import { CHAT_INPUT, INPUT_TARGET, SEND_BUTTON, captionAt as captionIn, pointerAt, typed } from "./usage-example-timeline.ts";
import type { Caption, CueSound, CursorKey } from "./usage-example-timeline.ts";

export { CHAT, CHAT_INPUT, SEND_BUTTON, STAGE, typed } from "./usage-example-timeline.ts";

// The failed screenshot beat sits between the bug and the prompt; every beat
// after it is written as its original time plus this offset.
const SNIP_SECONDS = 6.4;
const after = (seconds: number) => seconds + SNIP_SECONDS;
export const DURATION = after(34.5);
// Playback runs faster than script time.
export const SPEED = 1.25;

// Layout, in stage units. The game canvas draws the 480×270 scene at 1.5×.
export const GAME = { x: 40, y: 70, width: 720, titleBar: 36, height: 441 };
export const PIP = { x: 70, y: 300, width: 560, height: 380 };
// Inside the PiP: mode buttons, the frame strip, and the enlarged frame.
export const PIP_MANUAL_BUTTON = { x: PIP.x + 101, y: PIP.y + 68 };
export const STRIP = { y: PIP.y + 120, cardWidth: 100, cardHeight: 62, gapWidth: 26, spacing: 6, left: PIP.x + 16 };
export const LIGHTBOX_IMAGE = { x: PIP.x + 40, y: PIP.y + 76, width: 480, height: 270 };
export const CROP_BUTTON = { x: PIP.x + 61, y: PIP.y + 55 };
// The stray effect, in scene units (the scene is 480×270).
export const SQUARE = { x: 184, y: 96, size: 96 };
export const CROP_BOX = { x: SQUARE.x - 8, y: SQUARE.y - 8, size: SQUARE.size + 16 };
export const CROPPED_IMAGE = { x: LIGHTBOX_IMAGE.x + 140, y: LIGHTBOX_IMAGE.y + 35, size: 200 };

export const PROMPT_1 = "야 공격할 때 노란색 이펙트 생기는 거 뭐냐? 이거 없애줘";
export const PROMPT_2 = "이거 이펙트 없애줘!";

// Frames in the Manual strip, left to right. Representatives never catch
// the square; it only shows up in the second gap's in-between frames.
export type Frame = { swing: number | null; square: boolean };
export const STRIP_FRAMES = {
  representatives: [{ swing: null, square: false }, { swing: 0.05, square: false }, { swing: 0.95, square: false }, { swing: null, square: false }] as Frame[],
  gap: [{ swing: 0.15, square: false }, { swing: 0.5, square: true }] as Frame[],
};

// The strip's slots in order: card, gap, card, [in-between…], gap, card, gap, card.
export function stripSlots(expanded: boolean) {
  const slots: { kind: "card" | "gap" | "middle"; index: number; x: number; width: number; frame?: Frame; expanded?: boolean }[] = [];
  let x = STRIP.left;
  const push = (kind: "card" | "gap" | "middle", index: number, frame?: Frame, open?: boolean) => {
    const width = kind === "gap" ? STRIP.gapWidth : STRIP.cardWidth;
    slots.push({ kind, index, x, width, frame, expanded: open });
    x += width + STRIP.spacing;
  };
  STRIP_FRAMES.representatives.forEach((frame, index) => {
    push("card", index, frame);
    if (index === 1 && expanded) STRIP_FRAMES.gap.forEach((middle, middleIndex) => push("middle", middleIndex, middle));
    if (index < STRIP_FRAMES.representatives.length - 1) push("gap", index, undefined, index === 1 && expanded);
  });
  return slots;
}

const slotCenter = (kind: "gap" | "middle", index: number, expanded: boolean) => {
  const slot = stripSlots(expanded).find((candidate) => candidate.kind === kind && candidate.index === index)!;
  return { x: slot.x + slot.width / 2, y: STRIP.y + STRIP.cardHeight / 2 };
};
export const GAP_TARGET = slotCenter("gap", 1, false);
export const MIDDLE_TARGET = slotCenter("middle", 1, true);

const cropStart = { x: LIGHTBOX_IMAGE.x + CROP_BOX.x, y: LIGHTBOX_IMAGE.y + CROP_BOX.y };
const cropEnd = { x: cropStart.x + CROP_BOX.size, y: cropStart.y + CROP_BOX.size };
const croppedCenter = { x: CROPPED_IMAGE.x + CROPPED_IMAGE.size / 2, y: CROPPED_IMAGE.y + CROPPED_IMAGE.size / 2 };
const dropTarget = { x: CHAT_INPUT.x + 90, y: CHAT_INPUT.y + CHAT_INPUT.height / 2 };
// The screenshot tool's selection, in stage units, over the hero and sword.
export const SNIP_RECT = { start: { x: 170, y: 200 }, end: { x: 560, y: 470 } };
const inputTarget = INPUT_TARGET;

// Beats. Each is [start, end] in seconds.
export const BEATS = {
  bug: [0.4, 4.8],
  // The screenshot tool freezes the game, so the attack key does nothing:
  // five presses, a blocked stamp, then a capture without the square and a
  // card spelling out the catch-22.
  snip: {
    shortcut: 5, open: 5.2, attackKeys: [5.8, 6.1, 6.4, 6.7, 7.0], blocked: [5.8, 7.4],
    drag: [7.6, 8.2], shot: 8.35, close: 8.5, result: [8.6, 9.8], catch22: [9.9, 11.3],
  },
  prompt1: [after(5), after(7.6)],
  send1: after(7.9),
  reply1: { thinking: after(8.3), text: [after(9.3), after(10.4)], tool: after(10.6), done: after(11.3) },
  bald: after(11.8),
  baldZoom: [after(12), after(15)],
  pip: after(16),
  manual: after(17),
  expand: after(18),
  enlarge: after(19),
  cropMode: after(20),
  cropDrag: [after(20.8), after(21.6)],
  cropped: after(21.8),
  drag: [after(22.5), after(23.8)],
  drop: after(23.9),
  lightboxClose: after(24),
  pipMinimize: after(24.2),
  prompt2: [after(24.5), after(25.5)],
  send2: after(26),
  reply2: { thinking: after(26.3), text: [after(27), after(28.4)], tool: after(28.6), done: after(28.9) },
  fixed: after(28.9),
  end: DURATION,
} as const;

// The 8.3 swing lands right after the screenshot tool closes, just to taunt.
export const TAUNT_ATTACK = 8.7;
export const FIXED_ATTACK = after(29.5);
export const ATTACKS = [1, 2.4, 3.6, TAUNT_ATTACK, after(12.6), after(13.9), FIXED_ATTACK, after(30.7), after(31.9)];
const SWING_SECONDS = 0.35;
// The stray square pops in just after the swing starts and lingers a beat
// after it ends, so it is obnoxious but still gone before anyone can react.
const SQUARE_WINDOW: [number, number] = [0.05, 0.5];

export type GameState = { hair: boolean; sun: boolean; swing: number | null; square: boolean; slash: boolean; enemyHit: boolean; zoom: number };

export function gameAt(t: number): GameState {
  // The screenshot tool freezes the picture it opened on; nothing moves under it.
  if (t >= BEATS.snip.open && t < BEATS.snip.close) return gameAt(BEATS.snip.open - 0.3);
  const attack = ATTACKS.find((at) => t >= at && t < at + SWING_SECONDS);
  const swing = attack === undefined ? null : (t - attack) / SWING_SECONDS;
  const fixed = t >= BEATS.fixed;
  const [zoomIn, zoomOut] = BEATS.baldZoom;
  const zoomU = t < zoomIn || t >= zoomOut ? 0 : Math.min(1, (t - zoomIn) / 0.35, (zoomOut - t) / 0.5);
  return {
    hair: t < BEATS.bald || fixed,
    sun: t < BEATS.bald || fixed,
    swing,
    square: !fixed && ATTACKS.some((at) => at < BEATS.fixed && t >= at + SQUARE_WINDOW[0] && t < at + SQUARE_WINDOW[1]),
    slash: fixed && swing !== null,
    enemyHit: swing !== null && swing >= 0.45 && swing <= 0.8,
    zoom: 1 + 0.9 * zoomU * zoomU * (3 - 2 * zoomU),
  };
}

export function chatInputAt(t: number): { text: string; attachment: boolean } {
  if (t < BEATS.send1) return { text: typed(PROMPT_1, BEATS.prompt1, t), attachment: false };
  if (t < BEATS.drop) return { text: "", attachment: false };
  if (t < BEATS.send2) return { text: typed(PROMPT_2, BEATS.prompt2, t), attachment: true };
  return { text: "", attachment: false };
}

export const REPLY_1 = "알겠습니다! 공격할 때 보이는 노란색 요소를 찾아서 제거할게요.";
export const TOOL_1 = ["player.gd · hair_color(노란색) 노드 삭제", "background.gd · sun(노란색) 삭제", "preview_window · 최소화 버튼(노란색) 삭제"];
export const DONE_1 = "완료했어요. 이제 노란색은 보이지 않을 거예요 ✨";
export const REPLY_2 = "아, 이 노란 사각형이었군요! 공격 판정 디버그 박스가 켜져 있었어요. 끄고, 아까 지운 머리카락, 태양, 창 버튼도 되돌려 놓았어요.";
export const TOOL_2 = ["sword_attack.gd · debug_hitbox = false", "player.gd · hair_color 복구", "background.gd · sun 복구", "preview_window · 최소화 버튼 복구"];
export const DONE_2 = "이제 공격 이펙트만 깔끔하게 나와요.";

export type ChatMessage =
  | { id: string; role: "user"; text: string; image: boolean }
  | { id: string; role: "claudy"; text: string; thinking: boolean; tools: string[]; done: string };

export function chatAt(t: number): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (t >= BEATS.send1) messages.push({ id: "u1", role: "user", text: PROMPT_1, image: false });
  const r1 = BEATS.reply1;
  if (t >= r1.thinking) messages.push({
    id: "c1", role: "claudy", thinking: t < r1.text[0], text: typed(REPLY_1, r1.text, t),
    tools: t >= r1.tool ? TOOL_1 : [], done: t >= r1.done ? DONE_1 : "",
  });
  if (t >= BEATS.send2) messages.push({ id: "u2", role: "user", text: PROMPT_2, image: true });
  const r2 = BEATS.reply2;
  if (t >= r2.thinking) messages.push({
    id: "c2", role: "claudy", thinking: t < r2.text[0], text: typed(REPLY_2, r2.text, t),
    tools: t >= r2.tool ? TOOL_2 : [], done: t >= r2.done ? DONE_2 : "",
  });
  return messages;
}

export type PipState = {
  visible: boolean; minimized: boolean; manual: boolean; expanded: boolean;
  lightbox: boolean; cropMode: boolean; crop: number; cropped: boolean;
};

export function pipAt(t: number): PipState {
  const [dragStart, dragEnd] = BEATS.cropDrag;
  return {
    visible: t >= BEATS.pip,
    minimized: t >= BEATS.pipMinimize,
    manual: t >= BEATS.manual + 0.1,
    expanded: t >= BEATS.expand + 0.1,
    lightbox: t >= BEATS.enlarge + 0.1 && t < BEATS.lightboxClose,
    cropMode: t >= BEATS.cropMode + 0.1,
    crop: t < dragStart ? 0 : Math.min(1, (t - dragStart) / (dragEnd - dragStart)),
    cropped: t >= BEATS.cropped,
  };
}

export const CROP = { start: cropStart, end: cropEnd };

// The failed screenshot: shortcut, a frozen dimmed screen that ignores the
// attack key, a drag, the shutter, and a result without the square.
export function snipAt(t: number) {
  const snip = BEATS.snip;
  const key = t >= snip.shortcut && t < snip.shortcut + 0.7 ? "shortcut"
    : snip.attackKeys.some((at) => t >= at && t < at + 0.3) ? "attack" : null;
  const [dragStart, dragEnd] = snip.drag;
  return {
    key: key as "shortcut" | "attack" | null,
    blocked: t >= snip.blocked[0] && t < snip.blocked[1],
    presses: snip.attackKeys.filter((at) => t >= at).length,
    pressedNow: snip.attackKeys.some((at) => t >= at && t < at + 0.12),
    catch22: t >= snip.catch22[0] && t < snip.catch22[1],
    overlay: t >= snip.open && t < snip.close,
    selection: t < dragStart ? 0 : Math.min(1, (t - dragStart) / (dragEnd - dragStart)),
    flash: Math.max(0, 1 - Math.abs(t - snip.shot) / 0.18),
    result: t >= snip.result[0] && t < snip.result[1],
  };
}

// The pointer: keyframes with click moments, plus the drag that carries the
// cropped frame into the chat input.
const CURSOR_KEYS: CursorKey[] = [
  { t: 0, x: 640, y: 640 },
  { t: 5.3, x: 640, y: 640 },
  { t: 7.3, ...SNIP_RECT.start },
  { t: BEATS.snip.drag[0], ...SNIP_RECT.start },
  { t: BEATS.snip.drag[1], ...SNIP_RECT.end },
  { t: 9.1, ...SNIP_RECT.end },
  { t: after(4.85), ...inputTarget },
  { t: after(7.55), ...inputTarget },
  { t: after(7.85), ...SEND_BUTTON },
  { t: after(16.3), ...SEND_BUTTON },
  { t: after(16.95), ...PIP_MANUAL_BUTTON },
  { t: after(17.4), ...PIP_MANUAL_BUTTON },
  { t: after(17.95), ...GAP_TARGET },
  { t: after(18.4), ...GAP_TARGET },
  { t: after(18.95), ...MIDDLE_TARGET },
  { t: after(19.4), ...MIDDLE_TARGET },
  { t: after(19.95), ...CROP_BUTTON },
  { t: after(20.2), ...CROP_BUTTON },
  { t: after(20.75), ...cropStart },
  { t: BEATS.cropDrag[0], ...cropStart },
  { t: BEATS.cropDrag[1], ...cropEnd },
  { t: after(22), ...cropEnd },
  { t: after(22.45), ...croppedCenter },
  { t: BEATS.drag[0], ...croppedCenter },
  { t: BEATS.drag[1], ...dropTarget },
  { t: after(24.3), ...dropTarget },
  { t: after(24.45), ...inputTarget },
  { t: after(25.6), ...inputTarget },
  { t: after(25.95), ...SEND_BUTTON },
  { t: DURATION, ...SEND_BUTTON },
];
export const CLICKS = [after(4.9), BEATS.send1, BEATS.manual, BEATS.expand, BEATS.enlarge, BEATS.cropMode, BEATS.send2];
export const PRESSES: [number, number][] = [
  [BEATS.snip.drag[0] - 0.05, BEATS.snip.drag[1] + 0.05],
  [BEATS.cropDrag[0] - 0.05, BEATS.cropDrag[1] + 0.05],
  [BEATS.drag[0] - 0.05, BEATS.drop],
];

export function cursorAt(t: number) {
  const pointer = pointerAt(CURSOR_KEYS, CLICKS, PRESSES, t);
  const dragging = t >= BEATS.drag[0] && t < BEATS.drop;
  const crosshair = t >= BEATS.snip.open && t < BEATS.snip.close;
  return { ...pointer, dragging, crosshair };
}

export const CAPTIONS: Caption[] = [
  { text: "공격할 때마다 이상한 노란 네모가 번쩍…", start: 0.5, end: 4.8 },
  { text: "캡처 도구를 켜고 공격 키를 눌러봐도…", start: 5, end: 8.5 },
  { text: "…캡처 중엔 게임이 멈춰서 공격이 안 된다", start: 8.6, end: 9.8 },
  { text: "공격해야 보이는 버그인데, 캡처 중엔 공격이 안 된다", start: 9.9, end: 11.3 },
  { text: "결국 말로 설명해 봅니다", start: after(5.1), end: after(8) },
  { text: "…네모는 그대로, 노란 건 다 사라졌다", start: after(12.4), end: after(15.6) },
  { text: "방금그거뭐였지 Manual로 그 순간을 찾아서", start: after(16.2), end: after(21.7) },
  { text: "필요한 부분만 잘라 AI에게 끌어다 놓기", start: after(21.9), end: after(26.2) },
  { text: "정확한 화면을 보여주니, 한 번에 해결", start: after(29.2), end: after(33.8) },
];

export const captionAt = (t: number) => captionIn(CAPTIONS, t);

// Sounds, fired when the playhead crosses `at`.
export type SoundName = CueSound;
export const SOUND_CUES: { at: number; sound: SoundName }[] = [
  ...ATTACKS.map((at) => ({ at, sound: "swish" as const })),
  ...CLICKS.map((at) => ({ at, sound: "click" as const })),
  ...[0, 0.08, 0.16].map((offset) => ({ at: BEATS.snip.shortcut + offset, sound: "click" as const })),
  ...BEATS.snip.attackKeys.map((at) => ({ at, sound: "click" as const })),
  { at: BEATS.snip.shot, sound: "shutter" },
  { at: BEATS.snip.blocked[0] + 0.05, sound: "boing" },
  { at: BEATS.snip.catch22[0], sound: "whoosh" },
  { at: BEATS.send1 + 0.1, sound: "pop" },
  { at: BEATS.reply1.text[0], sound: "pop" },
  { at: BEATS.bald + 0.4, sound: "boing" },
  { at: BEATS.pip, sound: "pop" },
  { at: BEATS.drop, sound: "whoosh" },
  { at: BEATS.send2 + 0.1, sound: "pop" },
  { at: BEATS.reply2.text[0], sound: "pop" },
  { at: FIXED_ATTACK + 0.12, sound: "ding" },
];

// Typing windows that get key clicks.
export const TYPING: [number, number][] = [[...BEATS.prompt1], [...BEATS.prompt2]];
