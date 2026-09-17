// Script for the planner usage example (Manual). In a video meeting the
// conversion chart is on screen for one second. A screenshot is too late,
// asking again breaks the meeting, and a recording would mean scrubbing a
// 42-minute file only for the AI to reject the video. Manual finds the frame,
// crops just the chart (no faces, no chat) and drops it into the AI.
// Everything is a pure function of the playhead `t`.

import { INPUT_TARGET, SEND_BUTTON, captionAt as captionIn, pointerAt, typed, within } from "./usage-example-timeline.ts";
import type { Caption, CueSound, CursorKey } from "./usage-example-timeline.ts";

export const DURATION = 35;
export const SPEED = 1.25;

// The meeting window: shared slide, participant tiles, live caption, chat.
export const WORK = { x: 40, y: 70, width: 720, height: 600 };
export const SLIDE = { x: 12, y: 42, width: 540, height: 330 };
// The crop region (slide units) and where the chart content starts inside it.
export const CHART = { x: 36, y: 76, width: 492, height: 284 };
export const CHART_CONTENT_TOP = 100;
export const MEET_INPUT = { x: WORK.x + 574, y: WORK.y + 566 };
const REST = { x: WORK.x + 300, y: WORK.y + 250 };

// The "what if I had recorded it" card.
export const REC = { x: 70, y: 110, width: 660, height: 360 };
export const SCRUB = { y: REC.y + 300, left: REC.x + 30, width: 600 };
export const REC_FILE = { x: REC.x + 540, y: REC.y + 28 };
export const RECORDING_SECONDS = 42 * 60 + 18;
export const CHART_AT_SECONDS = 18 * 60 + 5;
const scrubX = (seconds: number) => SCRUB.left + (SCRUB.width * seconds) / RECORDING_SECONDS;

// The Manual PiP: frame strip, lightbox and crop.
export const PIP = { x: 70, y: 236, width: 560, height: 424 };
export const QUICK_MANUAL = { x: PIP.x + 190 + 10, y: PIP.y + PIP.height - 78 + 30 + 24 };
export const STRIP = { top: 110, cardWidth: 100, cardHeight: 62, gapWidth: 26, spacing: 6, left: 16 };
export const LIGHTBOX = { x: PIP.x + 88, y: PIP.y + 76, width: 384, height: 320 };
const SCALE = LIGHTBOX.width / WORK.width;
export const CROP_BUTTON = { x: PIP.x + 61, y: PIP.y + 55 };
export const CROP = {
  start: { x: LIGHTBOX.x + (SLIDE.x + CHART.x) * SCALE, y: LIGHTBOX.y + (SLIDE.y + CHART.y) * SCALE },
  end: { x: LIGHTBOX.x + (SLIDE.x + CHART.x + CHART.width) * SCALE, y: LIGHTBOX.y + (SLIDE.y + CHART.y + CHART.height) * SCALE },
};
export const CROPPED = { x: LIGHTBOX.x + 42, y: LIGHTBOX.y + 74, width: 300, height: 173 };
const CROPPED_CENTER = { x: CROPPED.x + CROPPED.width / 2, y: CROPPED.y + CROPPED.height / 2 };

export type Slide = "growth" | "chart" | "plan";
export const SLIDES: [number, Slide][] = [[0, "growth"], [2.6, "chart"], [3.6, "plan"]];
export const slideAt = (t: number): Slide => (SLIDES.findLast(([at]) => t >= at) ?? SLIDES[0])[1];

export const PROMPT = "회의에서 방금 넘어간 차트야. 핵심만 요약해줘";
export const HESITATION = "죄송한데 방금 슬라이드 다시…";
export const QUESTION = "모바일 결제 단계 이탈이 커졌는데, 지난주 결제 UI 배포 영향일까요?";

export const BEATS = {
  snip: 3.9,
  snipResult: [4.2, 5.6],
  meetClick: 4.9,
  hesitate: [5.0, 6.1],
  erase: [6.4, 6.9],
  recording: [7.4, 12.8],
  scrub: [7.8, 9.8],
  fileDrag: [10.3, 10.9],
  rejected: [10.95, 12.8],
  quickManual: 13.4,
  gap: 14.4,
  frame: 15.2,
  privacy: [15.5, 17.0],
  cropButton: 17.1,
  cropDrag: [17.4, 18.2],
  cropped: 18.3,
  drag: [18.8, 19.7],
  pipMinimize: 19.8,
  prompt: [19.9, 20.9],
  send: 21.2,
  reply: { thinking: 21.4, text: [21.9, 24.4], done: 24.6 },
  meetClick2: 25.2,
  question: [25.3, 26.6],
  asked: 26.8,
  praise: 27.2,
  board: 30.0,
  end: DURATION,
} as const;

// --- Meeting ------------------------------------------------------------------

export function liveCaptionAt(t: number) {
  if (t >= BEATS.praise && t < BEATS.board) return "오, 좋은 포인트네요. 바로 확인해볼게요.";
  if (t >= SLIDES[2][0]) return "다음 주 계획은 세 가지입니다.";
  if (t >= SLIDES[1][0]) return "전환율은 보시다시피… 네, 다음 장이요.";
  return "이번 주 신규 가입은 12% 늘었고요,";
}

export type MeetChat = { id: string; name: string; text: string; me: boolean };
export function meetingChatAt(t: number): { messages: MeetChat[]; input: string; typing: boolean } {
  const messages: MeetChat[] = [
    { id: "m1", name: "지수", text: "자료 링크 공유 부탁드려요", me: false },
    { id: "m2", name: "현우", text: "소리 잘 들립니다", me: false },
  ];
  if (t >= BEATS.asked) messages.push({ id: "me", name: "나", text: QUESTION, me: true });
  let input = "";
  if (within(t, [BEATS.hesitate[0], BEATS.erase[0]])) input = typed(HESITATION, BEATS.hesitate, t);
  else if (within(t, BEATS.erase)) input = Array.from(HESITATION).slice(0, Math.round(Array.from(HESITATION).length * (1 - (t - BEATS.erase[0]) / (BEATS.erase[1] - BEATS.erase[0])))).join("");
  else if (within(t, [BEATS.question[0], BEATS.asked])) input = typed(QUESTION, BEATS.question, t);
  const typing = within(t, [BEATS.hesitate[0], BEATS.erase[1]]) || within(t, [BEATS.question[0], BEATS.asked]);
  return { messages, input, typing };
}

// --- Recording detour -------------------------------------------------------------

export type RecordingState = { visible: boolean; seconds: number; searching: boolean; dragging: boolean; rejected: boolean };
export function recordingAt(t: number): RecordingState {
  const u = Math.min(1, Math.max(0, (t - BEATS.scrub[0]) / (BEATS.scrub[1] - BEATS.scrub[0])));
  // The playhead overshoots and hunts back and forth before landing.
  const hunt = u < 1 ? Math.sin(u * Math.PI * 5) * (1 - u) * 240 : 0;
  return {
    visible: within(t, BEATS.recording),
    seconds: Math.max(0, Math.round(CHART_AT_SECONDS * u + hunt)),
    searching: within(t, BEATS.scrub),
    dragging: within(t, BEATS.fileDrag),
    rejected: within(t, BEATS.rejected),
  };
}
export const formatTime = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

// --- Manual PiP -----------------------------------------------------------------

export type Frame = { id: string; slide: Slide; time: string; middle?: boolean };
const REPRESENTATIVES: Frame[] = [
  { id: "a1", slide: "growth", time: "14:02:31" },
  { id: "a2", slide: "growth", time: "14:02:33" },
  { id: "c1", slide: "plan", time: "14:02:35" },
  { id: "c2", slide: "plan", time: "14:02:39" },
];
// The chart slide only exists between the second and third cards.
const MIDDLES: Frame[] = [
  { id: "b1", slide: "chart", time: "14:02:34.2", middle: true },
  { id: "b2", slide: "chart", time: "14:02:34.6", middle: true },
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
    if (index === 1 && expanded) MIDDLES.forEach((middle) => push("middle", middle));
    if (index < REPRESENTATIVES.length - 1) push("gap", undefined, index === 1);
  });
  return slots;
}
const slotCenter = (slot: Slot) => ({ x: PIP.x + slot.x + slot.width / 2, y: PIP.y + STRIP.top + STRIP.cardHeight / 2 });
export const GAP_TARGET = slotCenter(stripSlots(false).find((slot) => slot.expandable)!);
export const FRAME_TARGET = slotCenter(stripSlots(true).find((slot) => slot.frame?.id === "b2")!);

export type ManualState = {
  visible: boolean; minimized: boolean; manual: boolean; expanded: boolean; lightbox: boolean;
  privacy: boolean; cropMode: boolean; cropBox: { x: number; y: number; width: number; height: number } | null;
  cropped: boolean; dragging: boolean; quickPressed: boolean;
};
export function manualAt(t: number): ManualState {
  const r = BEATS;
  const u = Math.min(1, Math.max(0, (t - r.cropDrag[0]) / (r.cropDrag[1] - r.cropDrag[0])));
  const cropBox = within(t, [r.cropDrag[0], r.cropped]) ? {
    x: CROP.start.x, y: CROP.start.y,
    width: (CROP.end.x - CROP.start.x) * u, height: (CROP.end.y - CROP.start.y) * u,
  } : null;
  return {
    visible: t < r.board,
    minimized: t < r.quickManual + 0.05 || t >= r.pipMinimize,
    manual: t >= r.quickManual + 0.05,
    expanded: t >= r.gap + 0.05,
    lightbox: t >= r.frame + 0.05,
    privacy: within(t, r.privacy),
    cropMode: within(t, [r.cropButton + 0.05, r.cropped]),
    cropBox,
    cropped: t >= r.cropped,
    dragging: within(t, r.drag),
    quickPressed: within(t, [r.quickManual - 0.06, r.quickManual + 0.05]),
  };
}

// --- AI chat ------------------------------------------------------------------------

export const REPLY = "지난주 결제 전환율이 3.2% → 2.4%로 0.8%p 떨어졌어요. 단계별로는 '결제 정보 입력'에서 이탈이 가장 크게 늘었고, 모바일(−1.1%p)이 하락을 대부분 만들었어요. 데스크톱은 거의 그대로예요.";
export const DONE = "회의에서 물어볼 만한 것: 지난주 모바일 결제 UI 배포와 하락 시점이 겹치는지.";

export type AiChat =
  | { id: string; role: "user"; text: string; image: boolean }
  | { id: string; role: "claudy"; text: string; thinking: boolean; done: string };
export function aiChatAt(t: number): AiChat[] {
  const r = BEATS;
  const messages: AiChat[] = [];
  if (t >= r.send) messages.push({ id: "u1", role: "user", text: PROMPT, image: true });
  if (t >= r.reply.thinking) messages.push({ id: "c1", role: "claudy", thinking: t < r.reply.text[0], text: typed(REPLY, r.reply.text, t), done: t >= r.reply.done ? DONE : "" });
  return messages;
}
export function aiInputAt(t: number): { text: string; image: boolean; typing: boolean; dropping: boolean } {
  const r = BEATS;
  if (within(t, [r.drag[1], r.send])) return { text: typed(PROMPT, r.prompt, t), image: true, typing: t >= r.prompt[0], dropping: false };
  return { text: "", image: false, typing: false, dropping: within(t, [r.drag[0] + 0.5, r.drag[1]]) || within(t, [r.fileDrag[0] + 0.3, r.fileDrag[1]]) };
}

// --- Board ---------------------------------------------------------------------------

export const RECORDING_PATH = ["녹화 켜두기", "42분 파일 열기", "1초 찾기", "프레임 추출", "자르기", "AI 업로드"];
export const MANUAL_PATH = ["사이 화면 펼치기", "차트만 자르기", "AI에 끌어다 놓기"];
export const boardStepAt = (t: number) => t < BEATS.board ? 0 : Math.floor((t - BEATS.board) / 0.22) + 1;

// --- Pointer, keys, captions, sound ---------------------------------------------------

const CURSOR_KEYS: CursorKey[] = [
  { t: 0, ...REST },
  { t: 4.6, ...REST },
  { t: 4.85, ...MEET_INPUT },
  { t: 7.1, ...MEET_INPUT },
  { t: 7.6, x: scrubX(0), y: SCRUB.y },
  { t: BEATS.scrub[0], x: scrubX(0), y: SCRUB.y },
  { t: BEATS.scrub[1], x: scrubX(CHART_AT_SECONDS), y: SCRUB.y },
  { t: 10.1, ...REC_FILE },
  { t: BEATS.fileDrag[0], ...REC_FILE },
  { t: BEATS.fileDrag[1], ...INPUT_TARGET },
  { t: 12.8, ...INPUT_TARGET },
  { t: 13.25, ...QUICK_MANUAL },
  { t: 13.55, ...QUICK_MANUAL },
  { t: 14.2, ...GAP_TARGET },
  { t: 14.55, ...GAP_TARGET },
  { t: 15.0, ...FRAME_TARGET },
  { t: 15.35, ...FRAME_TARGET },
  { t: 16.9, ...CROP_BUTTON },
  { t: 17.2, ...CROP_BUTTON },
  { t: BEATS.cropDrag[0], ...CROP.start },
  { t: BEATS.cropDrag[1], ...CROP.end },
  { t: 18.6, ...CROPPED_CENTER },
  { t: BEATS.drag[0], ...CROPPED_CENTER },
  { t: BEATS.drag[1], ...INPUT_TARGET },
  { t: 21.0, ...INPUT_TARGET },
  { t: 21.15, ...SEND_BUTTON },
  { t: 24.8, ...SEND_BUTTON },
  { t: 25.1, ...MEET_INPUT },
  { t: 26.9, ...MEET_INPUT },
  { t: 28.0, ...REST },
  { t: DURATION, ...REST },
];

export const CLICKS = [BEATS.meetClick, BEATS.quickManual, BEATS.gap, BEATS.frame, BEATS.cropButton, BEATS.send, BEATS.meetClick2];
const PRESSES: [number, number][] = [[...BEATS.scrub], [...BEATS.fileDrag], [...BEATS.cropDrag], [...BEATS.drag]];
export function cursorAt(t: number) {
  const pointer = pointerAt(CURSOR_KEYS, CLICKS, PRESSES, t);
  return { ...pointer, crosshair: within(t, BEATS.cropDrag) };
}

export function keysAt(t: number): { keys: string[]; note?: string } | null {
  if (within(t, [BEATS.snip, BEATS.snip + 0.2])) return { keys: ["⊞ Win", "Shift", "S"] };
  if (within(t, BEATS.erase)) return { keys: ["Backspace"], note: "…역시 말자" };
  if (within(t, [BEATS.asked - 0.15, BEATS.asked + 0.2])) return { keys: ["Enter"] };
  return null;
}

export const CAPTIONS: Caption[] = [
  { text: "주간 회의 · 팀장님이 대시보드를 넘기며 발표 중", start: 0.2, end: 2.5 },
  { text: "전환율 슬라이드가 1초 만에 넘어갔다", start: 2.6, end: 4.8 },
  { text: "“다시 보여주세요”… 회의 흐름 때문에 못 한다", start: 4.9, end: 7.3 },
  { text: "녹화해뒀어도: 42분 영상에서 그 1초를 찾아야 하고", start: 7.4, end: 10.1 },
  { text: "AI는 영상 파일을 받지 못한다", start: 10.2, end: 12.9 },
  { text: "방금그거뭐였지 1번 → 지나간 화면 사이를 펼친다", start: 13.0, end: 15.4 },
  { text: "찾았다. 얼굴·채팅은 빼고", start: 15.5, end: 17.0 },
  { text: "차트만 잘라서 AI에 끌어다 놓기", start: 17.1, end: 21.3 },
  { text: "영상도 파일도 없이, 회의 중 바로 숫자와 맥락 파악", start: 21.4, end: 25.0 },
  { text: "회의를 멈추지 않고, 오히려 날카로운 질문까지", start: 25.1, end: 29.9 },
  { text: "녹화 다음의 노가다까지 없앤다", start: 30.2, end: 34.8 },
];
export const captionAt = (t: number) => captionIn(CAPTIONS, t);

export const SOUND_CUES: { at: number; sound: CueSound }[] = [
  ...CLICKS.map((at) => ({ at, sound: "click" as const })),
  { at: SLIDES[1][0], sound: "swish" },
  { at: SLIDES[2][0], sound: "swish" },
  { at: BEATS.snip + 0.2, sound: "shutter" },
  { at: BEATS.recording[0], sound: "whoosh" },
  { at: BEATS.rejected[0], sound: "boing" },
  { at: BEATS.cropped, sound: "pop" },
  { at: BEATS.drag[1], sound: "pop" },
  { at: BEATS.send + 0.1, sound: "pop" },
  { at: BEATS.reply.text[1], sound: "ding" },
  { at: BEATS.asked, sound: "pop" },
  { at: BEATS.praise, sound: "ding" },
  { at: BEATS.board, sound: "whoosh" },
];

export const TYPING: [number, number][] = [[...BEATS.hesitate], [...BEATS.prompt], [...BEATS.question]];
