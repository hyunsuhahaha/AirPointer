// Script for the publisher usage example (Manual). A 0.4 s card-expand
// transition in a reference app can't be described in words: the AI answers
// with a generic fade + scale, and a screen recording can't be attached.
// Manual opens the frames inside those 0.4 s; start, middle and end go to the
// AI, which reads the motion off them, and the result plays in lockstep with
// the reference. Everything is a pure function of the playhead `t`.

import { INPUT_TARGET, SEND_BUTTON, captionAt as captionIn, pointerAt, typed, within } from "./usage-example-timeline.ts";
import type { Caption, CueSound, CursorKey } from "./usage-example-timeline.ts";

export const DURATION = 42;
export const SPEED = 1.25;

// Two windows on the left: the emulator being shared, and the local preview.
export const WORK = { x: 40, y: 70, width: 720, height: 600 };
export const PHONE = { width: 220, height: 420 };
export const PHONE_REF = { x: WORK.x + 70, y: WORK.y + 104, ...PHONE };
export const PHONE_MINE = { x: WORK.x + 430, y: WORK.y + 104, ...PHONE };
const REST = { x: WORK.x + 360, y: WORK.y + 320 };

// The card inside a phone, collapsed and expanded (phone units).
export const CARD_SMALL = { x: 14, y: 70, width: 192, height: 120, radius: 22 };
export const CARD_FULL = { x: 0, y: 0, width: PHONE.width, height: PHONE.height, radius: 0 };
export const cardTarget = (phone: typeof PHONE_REF) => ({ x: phone.x + CARD_SMALL.x + CARD_SMALL.width / 2, y: phone.y + CARD_SMALL.y + CARD_SMALL.height / 2 });
export const backTarget = (phone: typeof PHONE_REF) => ({ x: phone.x + 24, y: phone.y + 26 });

export const PIP = { x: 70, y: 236, width: 560, height: 424 };
export const QUICK_MANUAL = { x: PIP.x + 190 + 10, y: PIP.y + PIP.height - 78 + 30 + 24 };
export const STRIP = { top: 104, cardWidth: 60, cardHeight: 96, gapWidth: 22, spacing: 6, left: 16 };

export const REQUEST = "이거랑 똑같이 해주세요 🙏";
export const REQUEST_DETAIL = "트립메이트 앱에서 카드 누르면 쫙 펼쳐지는 거요!";
export const DESCRIBE = "카드 누르면 커지면서 모서리가 펴지고 화면 꽉 차게… 부드럽게 해줘";
export const PROMPT = "이 3장(시작·중간·끝)처럼 카드 펼침 애니메이션 만들어줘";

export const BEATS = {
  // The teammate's message fills the screen, then stays pinned as a note.
  request: [0.2, 2.4],
  refTaps: [3.1, 6],
  refBacks: [4.6, 7.6],
  describeClick: 8.15,
  describe: [8.2, 9.4],
  send1: 9.7,
  reply1: { thinking: 9.9, text: [10, 10.4], done: 10.5 },
  // The wrong result plays next to the reference, twice.
  wrongCompare: [10.6, 14.4],
  videoPaste: 14.6,
  videoRejected: [14.8, 16.1],
  quickManual: 16.3,
  gap: 17.3,
  drags: [[20, 20.7], [20.9, 21.6], [21.8, 22.5]],
  pipMinimize: 22.7,
  prompt: [22.8, 24],
  send2: 24.3,
  reply2: { thinking: 24.5, tools: [24.9, 25.3, 25.7], text: [26, 28], code: 28.2, done: 28.6 },
  compare: [29, 34.8],
  board: 35,
  end: DURATION,
} as const;
export const TRANSITION_SECONDS = 0.4;

// --- Motion ------------------------------------------------------------------------

export const easeOut = (u: number) => 1 - (1 - u) ** 3;
type Segment = readonly [start: number, dir: 1 | -1];
const COMPARE_SEGMENTS: Segment[] = [[29.6, 1], [31.2, -1], [32.6, 1]];
const WRONG_SEGMENTS: Segment[] = [[10.8, 1], [11.8, -1], [12.8, 1], [13.8, -1]];
const REF_SEGMENTS: Segment[] = [[BEATS.refTaps[0], 1], [BEATS.refBacks[0], -1], [BEATS.refTaps[1], 1], [BEATS.refBacks[1], -1], ...WRONG_SEGMENTS, ...COMPARE_SEGMENTS];

function progress(segments: Segment[], t: number, seconds = TRANSITION_SECONDS) {
  let state = 0;
  for (const [start, dir] of segments) {
    if (t < start) break;
    const u = easeOut(Math.min(1, (t - start) / seconds));
    state = dir === 1 ? u : 1 - u;
  }
  return state;
}

// How far the reference card is open (0 list … 1 full screen).
export const refProgressAt = (t: number) => progress(REF_SEGMENTS, t);

export type Rect = { x: number; y: number; width: number; height: number; radius: number };
export const cardRect = (p: number): Rect => ({
  x: CARD_SMALL.x + (CARD_FULL.x - CARD_SMALL.x) * p,
  y: CARD_SMALL.y + (CARD_FULL.y - CARD_SMALL.y) * p,
  width: CARD_SMALL.width + (CARD_FULL.width - CARD_SMALL.width) * p,
  height: CARD_SMALL.height + (CARD_FULL.height - CARD_SMALL.height) * p,
  radius: CARD_SMALL.radius * (1 - p),
});
// The detail text fades in over the second half of the transition.
export const bodyOpacity = (p: number) => Math.min(1, Math.max(0, (p - 0.6) / 0.4));

// The local preview: nothing, then the AI's wrong fade + scale, then the fix.
export type MineState = { kind: "idle" | "wrong" | "right"; progress: number };
export function mineAt(t: number): MineState {
  if (t >= BEATS.reply2.done) return { kind: "right", progress: progress(COMPARE_SEGMENTS, t) };
  if (t >= BEATS.reply1.done) return { kind: "wrong", progress: progress(WRONG_SEGMENTS, t) };
  return { kind: "idle", progress: 0 };
}
export const comparingAt = (t: number) => within(t, BEATS.compare) || within(t, BEATS.wrongCompare);
export const wrongComparingAt = (t: number) => within(t, BEATS.wrongCompare);
// The "same motion" badge appears once the first side-by-side expand has played.
export const SAME_BADGE_AT = COMPARE_SEGMENTS[0][0] + TRANSITION_SECONDS + 0.2;
export const requestAt = (t: number): "big" | "pinned" | null => t < BEATS.request[0] ? null : t < BEATS.request[1] ? "big" : t < BEATS.board ? "pinned" : null;

// --- Manual strip ----------------------------------------------------------------------

export type Frame = { id: string; at: number; label: string; middle?: boolean };
const REPRESENTATIVES: Frame[] = [
  { id: "r1", at: 2.9, label: "0.00s" },
  { id: "r2", at: 3.8, label: "0.40s" },
  { id: "r3", at: 5.4, label: "목록" },
  { id: "r4", at: 6.6, label: "상세" },
];
// The frames inside the first 0.4 s transition, between r1 and r2.
const MIDDLES: Frame[] = [
  { id: "m1", at: BEATS.refTaps[0] + 0.12, label: "+0.12s", middle: true },
  { id: "m2", at: BEATS.refTaps[0] + 0.2, label: "+0.20s", middle: true },
  { id: "m3", at: BEATS.refTaps[0] + 0.3, label: "+0.30s", middle: true },
];
export type Slot = { kind: "card" | "gap" | "middle"; x: number; width: number; frame?: Frame; expandable?: boolean };
export function stripSlots(expanded: boolean): Slot[] {
  const slots: Slot[] = [];
  let x = STRIP.left;
  const push = (kind: Slot["kind"], frame?: Frame, expandable = false) => {
    const width = kind === "gap" ? STRIP.gapWidth : STRIP.cardWidth;
    slots.push({ kind, x, width, frame, expandable });
    x += width + STRIP.spacing;
  };
  REPRESENTATIVES.forEach((frame, index) => {
    push("card", frame);
    if (index === 0 && expanded) MIDDLES.forEach((middle) => push("middle", middle));
    if (index < REPRESENTATIVES.length - 1) push("gap", undefined, index === 0);
  });
  return slots;
}
// Frames sit 8px below the strip top to leave room for the order badges.
const slotCenter = (slot: Slot) => ({ x: PIP.x + slot.x + slot.width / 2, y: PIP.y + STRIP.top + 8 + STRIP.cardHeight / 2 });
export const GAP_TARGET = slotCenter(stripSlots(false).find((slot) => slot.expandable)!);
// Start, middle, end: dragged into the AI in this order.
export const PICKS = ["r1", "m2", "r2"] as const;
export const PICK_SOURCES = PICKS.map((id) => slotCenter(stripSlots(true).find((slot) => slot.frame?.id === id)!));
export const frameProgress = (id: string) => refProgressAt([...REPRESENTATIVES, ...MIDDLES].find((frame) => frame.id === id)!.at);

export type ManualState = {
  visible: boolean; minimized: boolean; manual: boolean; expanded: boolean;
  picked: string[]; dragging: string | null; quickPressed: boolean;
};
export function manualAt(t: number): ManualState {
  const r = BEATS;
  const dragIndex = r.drags.findIndex((span) => within(t, span));
  return {
    visible: t < r.board,
    minimized: t < r.quickManual + 0.05 || t >= r.pipMinimize,
    manual: t >= r.quickManual + 0.05,
    expanded: t >= r.gap + 0.05,
    picked: PICKS.filter((_, index) => t >= r.drags[index][1]),
    dragging: dragIndex >= 0 ? PICKS[dragIndex] : null,
    quickPressed: within(t, [r.quickManual - 0.06, r.quickManual + 0.05]),
  };
}

// --- AI chat ------------------------------------------------------------------------------

export const REPLY_1 = "카드에 transition을 추가했어요 ✅";
export const DONE_1 = "opacity 0 → 1, scale 0.85 → 1로 부드럽게 나타나요.";
export const TOOLS_2 = [
  "0.00s → +0.20s: 폭 192 → 216px (이미 88%) · 강한 ease-out",
  "모서리 22px → 3px → 0 · 위치는 카드 자리에서 시작",
  "본문 텍스트는 +0.24s 이후 등장 · 튕김(overshoot) 없음",
];
export const REPLY_2 = "세 장을 비교하면, 카드가 제자리에서 화면 전체로 커지면서 모서리가 펴지고 본문은 늦게 나타나요. 처음에 빠르고 끝에 느린 ease-out이라 0.2초 만에 거의 다 열립니다.";
export const CODE = [
  ".card { transition: all .4s cubic-bezier(.2, .9, .3, 1); }",
  ".card.open { inset: 0; border-radius: 0; }",
  ".card .body { transition: opacity .16s .24s; }",
];
export const DONE_2 = "적용했어요. 오른쪽 미리보기에서 레퍼런스와 나란히 확인해 보세요.";

export type MotionChat =
  | { id: string; role: "user"; text: string; frames: string[] }
  | { id: string; role: "claudy"; text: string; thinking: boolean; tools: string[]; done: string; code: boolean };
export function chatAt(t: number): MotionChat[] {
  const r = BEATS;
  const messages: MotionChat[] = [];
  if (t >= r.send1) messages.push({ id: "u1", role: "user", text: DESCRIBE, frames: [] });
  if (t >= r.reply1.thinking) messages.push({ id: "c1", role: "claudy", thinking: t < r.reply1.text[0], text: typed(REPLY_1, r.reply1.text, t), tools: [], done: t >= r.reply1.done ? DONE_1 : "", code: false });
  if (t >= r.send2) messages.push({ id: "u2", role: "user", text: PROMPT, frames: [...PICKS] });
  const r2 = r.reply2;
  if (t >= r2.thinking) messages.push({
    id: "c2", role: "claudy", thinking: t < r2.text[0], text: typed(REPLY_2, r2.text, t),
    tools: TOOLS_2.filter((_, index) => t >= r2.tools[index]), done: t >= r2.done ? DONE_2 : "", code: t >= r2.code,
  });
  return messages;
}

export function inputAt(t: number): { text: string; frames: string[]; typing: boolean; dropping: boolean; video: boolean } {
  const r = BEATS;
  const picked = manualAt(t).picked;
  const dropping = r.drags.some(([start, end]) => within(t, [start + 0.35, end]));
  if (t < r.send1) return { text: typed(DESCRIBE, r.describe, t), frames: [], typing: within(t, [r.describe[0], r.send1]), dropping: false, video: false };
  if (within(t, [r.videoPaste, r.videoRejected[1]])) return { text: "", frames: [], typing: false, dropping: false, video: true };
  if (within(t, [r.drags[0][0], r.send2])) return { text: typed(PROMPT, r.prompt, t), frames: picked, typing: t >= r.prompt[0], dropping, video: false };
  return { text: "", frames: [], typing: false, dropping: false, video: false };
}

// --- Board --------------------------------------------------------------------------------

export const COMPARISON: { label: string; before: string; after: string }[] = [
  { label: "AI에 전달한 것", before: "애매한 설명 한 줄", after: "시작·중간·끝 3장" },
  { label: "화면 녹화 파일", before: "첨부 불가", after: "필요 없음" },
  { label: "AI가 만든 움직임", before: "fade + scale (다름)", after: "레퍼런스와 같음" },
  { label: "수정 왕복", before: "계속", after: "1번" },
];
export const boardRowsAt = (t: number) => t < BEATS.board ? 0 : Math.min(COMPARISON.length, Math.floor((t - BEATS.board) / 0.35) + 1);

// --- Pointer, keys, captions, sound -------------------------------------------------------

const CURSOR_KEYS: CursorKey[] = [
  { t: 0, ...REST },
  { t: 2.8, ...cardTarget(PHONE_REF) },
  { t: 3.2, ...cardTarget(PHONE_REF) },
  { t: 4.4, ...backTarget(PHONE_REF) },
  { t: 4.7, ...backTarget(PHONE_REF) },
  { t: 5.8, ...cardTarget(PHONE_REF) },
  { t: 6.1, ...cardTarget(PHONE_REF) },
  { t: 7.4, ...backTarget(PHONE_REF) },
  { t: 7.7, ...backTarget(PHONE_REF) },
  { t: 8.1, ...INPUT_TARGET },
  { t: 9.5, ...INPUT_TARGET },
  { t: 9.65, ...SEND_BUTTON },
  { t: 9.9, ...SEND_BUTTON },
  { t: 10.4, ...REST },
  { t: 14.1, ...REST },
  { t: 14.5, ...INPUT_TARGET },
  { t: 16, ...INPUT_TARGET },
  { t: 16.2, ...QUICK_MANUAL },
  { t: 16.4, ...QUICK_MANUAL },
  { t: 17.1, ...GAP_TARGET },
  { t: 17.4, ...GAP_TARGET },
  ...BEATS.drags.flatMap(([start, end], index) => [
    { t: start - 0.15, ...PICK_SOURCES[index] },
    { t: start, ...PICK_SOURCES[index] },
    { t: end, ...INPUT_TARGET },
  ]),
  { t: 24.1, ...INPUT_TARGET },
  { t: 24.25, ...SEND_BUTTON },
  { t: 28.8, ...SEND_BUTTON },
  { t: 29.4, ...REST },
  { t: DURATION, ...REST },
];

export const CLICKS = [
  BEATS.refTaps[0], BEATS.refBacks[0], BEATS.refTaps[1], BEATS.refBacks[1], BEATS.describeClick, BEATS.send1,
  BEATS.quickManual, BEATS.gap, BEATS.send2,
];
const PRESSES = BEATS.drags.map(([start, end]) => [start, end] as [number, number]);
export const cursorAt = (t: number) => pointerAt(CURSOR_KEYS, CLICKS, PRESSES, t);

export function keysAt(t: number): { keys: string[]; note?: string } | null {
  if (within(t, [BEATS.videoPaste - 0.1, BEATS.videoPaste + 0.3])) return { keys: ["Ctrl", "V"], note: "reference.mp4" };
  return null;
}

export const CAPTIONS: Caption[] = [
  { text: "기획자가 보낸 한 마디: “이거랑 똑같이 해주세요”", start: 0.2, end: 4.5 },
  { text: "0.4초짜리 전환… 정확히 어떻게 움직이지?", start: 4.6, end: 8 },
  { text: "말로 설명해 보지만", start: 8.1, end: 9.8 },
  { text: "AI 결과를 레퍼런스와 나란히 두 번 재생", start: 9.9, end: 12.3 },
  { text: "레퍼런스는 제자리에서 펼쳐지고, AI 결과는 뚝뚝 끊기며 나타난다", start: 12.4, end: 14.5 },
  { text: "녹화 파일은? AI가 영상을 받지 못한다", start: 14.6, end: 16.1 },
  { text: "방금그거뭐였지 1번 → 0.4초 사이 화면을 펼친다", start: 16.2, end: 19.8 },
  { text: "시작 · 중간 · 끝 3장을 순서대로 AI에", start: 19.9, end: 24.4 },
  { text: "AI가 프레임을 비교해 움직임을 읽어낸다", start: 24.5, end: 28.9 },
  { text: "레퍼런스와 나란히: 같은 전환", start: 29, end: 34.8 },
  { text: "움직임은 말 대신, 사이 화면으로", start: 35.2, end: 41.8 },
];
export const captionAt = (t: number) => captionIn(CAPTIONS, t);

export const SOUND_CUES: { at: number; sound: CueSound }[] = [
  ...CLICKS.map((at) => ({ at, sound: "click" as const })),
  { at: BEATS.request[0], sound: "pop" },
  ...REF_SEGMENTS.filter(([, dir]) => dir === 1).map(([at]) => ({ at, sound: "swish" as const })),
  { at: BEATS.reply1.done, sound: "pop" },
  { at: BEATS.videoRejected[0], sound: "boing" },
  ...BEATS.drags.map(([, end]) => ({ at: end, sound: "pop" as const })),
  { at: BEATS.send2 + 0.1, sound: "pop" },
  { at: BEATS.reply2.code, sound: "ding" },
  { at: COMPARE_SEGMENTS[0][0], sound: "ding" },
  { at: BEATS.board, sound: "whoosh" },
];

export const TYPING: [number, number][] = [[...BEATS.describe], [...BEATS.prompt]];
