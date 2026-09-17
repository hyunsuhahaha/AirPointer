// Script for the QA engineer usage example: the same checkout bug is filed
// twice. Before: six reproduction steps, six screenshots, 18m40s and two
// follow-up questions. After: an Agent Link in the issue, 12 seconds, and the
// developer's AI confirms the repro. A comparison board closes the example.
// Everything is a pure function of the playhead `t`.

import { CHAT, INPUT_TARGET, SEND_BUTTON, captionAt as captionIn, pointerAt, typed, within } from "./usage-example-timeline.ts";
import type { Caption, CueSound, CursorKey } from "./usage-example-timeline.ts";

export const DURATION = 41.1;
export const SPEED = 1.25;

// Layout, in stage units: the shop checkout on the left, the tracker on the right.
export const WORK = { x: 40, y: 70, width: 720, height: 600 };
export const COUPON_BUTTON = { x: WORK.x + 620, y: WORK.y + 222 };
export const SHIP_BUTTON = { x: WORK.x + 620, y: WORK.y + 282 };
export const MODAL_SAVE = { x: WORK.x + 470, y: WORK.y + 452 };
export const TOTAL_POINT = { x: WORK.x + 560, y: WORK.y + 380 };
export const TRACKER = CHAT;
export const TITLE_FIELD = { x: TRACKER.x + 225, y: TRACKER.y + 104 };
export const REPRO_FIELD = { x: TRACKER.x + 225, y: TRACKER.y + 196 };
export const STEPS_AREA = { x: TRACKER.x + 225, y: TRACKER.y + 330 };
export const SUBMIT = { x: TRACKER.x + 370, y: TRACKER.y + 566 };

export const PIP = { x: 70, y: 236, width: 560, height: 424 };
export const QUICK_LINK = { x: PIP.x + 190 + 36, y: PIP.y + PIP.height - 78 + 30 + 24 };
export const PIP_EXPORT = { x: PIP.x + 280, y: PIP.y + 150 };
export const COPY_BUTTON = { x: PIP.x + 280, y: PIP.y + 390 };

export const LINK_URL = "https://whatwas.vercel.app/context/Vd3pQ8rNx2LmYt6Kc0Aw_hZ4sBeJ9uGf7oTi1RkMnq/agent";
export const ISSUE_TITLE = "쿠폰 적용 후 배송지 변경 시 할인 해제";
export const STEPS = [
  "/cart 진입, 상품 1개 담기",
  "쿠폰 WELCOME20 적용 → 39,200원",
  "주문서에서 배송지 '변경' 클릭",
  "새 배송지 선택 후 저장",
  "결제 금액이 49,000원으로 복귀",
  "쿠폰 표시는 '적용됨'으로 유지",
];
export const ENVIRONMENT = "Chrome 128 · macOS 14.6 · staging";

export const BEATS = {
  couponClick: 0.6,
  shipClick: 1.4,
  modalSave: 2.0,
  // One documentation round per step: snip, paste, type.
  steps: [5.6, 7.2, 8.8, 10.4, 12, 13.6],
  environment: [15, 15.6],
  submit1: 16.1,
  reply: [18.2, 18.9],
  send1: 19.2,
  transition: [22.1, 23.1],
  pip: 23.3,
  quickLink: 23.8,
  pipExport: 24.4,
  exporting: [24.5, 25.2],
  exported: 25.3,
  copy: 25.8,
  titleClick: 26.2,
  title: [26.3, 27.1],
  reproClick: 27.5,
  pasteLink: 27.7,
  pipMinimize: 27.8,
  submit2: 28.4,
  analysis: { thinking: 29, tools: [29.3, 29.6, 29.9], text: [30.1, 32], done: 32.2 },
  fixing: 32.8,
  resolved: 34,
  board: 34.8,
  end: DURATION,
} as const;
export const SNIP_DELAY = 0.2;
export const PASTE_AFTER = 0.4;
export const TYPE_SPAN = [0.5, 1.3] as const;

export type Phase = "before" | "transition" | "after";
export const phaseAt = (t: number): Phase => t < BEATS.transition[0] ? "before" : t < BEATS.transition[1] ? "transition" : "after";

// --- Shop checkout ------------------------------------------------------------

// Checkout screens, also used for the step screenshots (index = step).
export type ShopScreen = "cart" | "coupon" | "modal" | "address" | "bugTotal" | "bugBadge";
export const STEP_SCREENS: ShopScreen[] = ["cart", "coupon", "modal", "address", "bugTotal", "bugBadge"];

export function shopAt(t: number): ShopScreen {
  const r = BEATS;
  const round = r.steps.findLast((at) => within(t, [at - 0.4, at + 1.6]));
  if (round !== undefined && t < r.submit1) return STEP_SCREENS[r.steps.indexOf(round)];
  if (t < r.couponClick) return "cart";
  if (t < r.shipClick) return "coupon";
  if (t < r.modalSave - 0.25) return "modal";
  if (t < r.modalSave) return "address";
  return "bugTotal";
}
export const totalFor = (screen: ShopScreen) => screen === "coupon" || screen === "modal" || screen === "address" ? "39,200원" : "49,000원";
export const couponAppliedFor = (screen: ShopScreen) => screen !== "cart";
// The discount line: shown once the coupon is on, lost after the address change.
export const discountFor = (screen: ShopScreen) => screen === "cart" ? null : screen === "bugTotal" || screen === "bugBadge" ? "0원" : "−9,800원";
// Right after the address change, the bug is spelled out on screen.
export const calloutAt = (t: number) => within(t, [BEATS.modalSave + 0.1, BEATS.steps[0] - 0.4]);

// --- Tracker ------------------------------------------------------------------

export type TrackerState =
  | { mode: "form"; issue: "before"; title: string; steps: { text: string; shot: ShopScreen | null }[]; environment: string; typing: boolean }
  | { mode: "form"; issue: "after"; title: string; link: boolean; typing: boolean }
  | { mode: "issue"; issue: "before"; comments: Comment[]; input: string; typing: boolean; status: Status }
  | { mode: "issue"; issue: "after"; comments: Comment[]; status: Status }
  | { mode: "blank" };
export type Status = "접수" | "재현 대기" | "수정 중" | "해결됨";
export type Comment =
  | { id: string; kind: "person"; author: "minjun" | "me"; text: string }
  | { id: string; kind: "analysis"; thinking: boolean; tools: string[]; text: string; done: string; evidence: boolean };

export const QUESTIONS = [
  { id: "q1", at: 16.8, text: "3단계 배송지 변경은 주문서 모달에서 하신 건가요, 마이페이지에서 하신 건가요? 쿠폰 적용 순서도 확인 부탁드립니다." },
  { id: "q2", at: 20, text: "말씀하신 순서로 해봤는데 재현이 안 됩니다. 콘솔 로그와 네트워크 기록도 첨부 가능할까요?" },
];
export const REPLY = "주문서 모달입니다. 쿠폰을 먼저 적용했습니다.";
export const TOOLS = ["Agent Link 열기 · 최근 30초", "events.json · 화면 변화 14건", "captures 12장 · 01:02:14 결제 금액 확대"];
export const ANALYSIS = "재현 확인했습니다. 01:02:11 배송지 저장 직후 결제 금액이 39,200원에서 49,000원으로 돌아갑니다. 쿠폰 배지는 '적용됨'으로 남아 있어 화면 상태와 금액이 어긋납니다.";
export const ANALYSIS_DONE = "배송지 변경 후 장바구니 재계산 요청에 coupon_id가 빠지는 경로로 보입니다.";
export const FIX_COMMENT = "재현 영상으로 바로 확인했습니다. 수정 PR 올렸습니다.";

const stepText = (index: number, t: number) => {
  const at = BEATS.steps[index];
  return typed(`${index + 1}. ${STEPS[index]}`, [at + TYPE_SPAN[0], at + TYPE_SPAN[1]], t);
};

export function trackerAt(t: number): TrackerState {
  const r = BEATS;
  if (t < r.submit1) {
    const steps = r.steps.flatMap((at, index) => t >= at + PASTE_AFTER ? [{ text: stepText(index, t), shot: STEP_SCREENS[index] }] : []);
    const typing = r.steps.some((at) => within(t, [at + TYPE_SPAN[0], at + TYPE_SPAN[1]])) || within(t, r.environment);
    return { mode: "form", issue: "before", title: ISSUE_TITLE, steps, environment: typed(ENVIRONMENT, r.environment, t), typing };
  }
  if (t < r.transition[0]) {
    const comments: Comment[] = [];
    if (t >= QUESTIONS[0].at) comments.push({ id: "q1", kind: "person", author: "minjun", text: QUESTIONS[0].text });
    if (t >= r.send1) comments.push({ id: "r1", kind: "person", author: "me", text: REPLY });
    if (t >= QUESTIONS[1].at) comments.push({ id: "q2", kind: "person", author: "minjun", text: QUESTIONS[1].text });
    const input = within(t, [r.reply[0], r.send1]) ? typed(REPLY, r.reply, t) : "";
    return { mode: "issue", issue: "before", comments, input, typing: input !== "", status: t >= QUESTIONS[1].at ? "재현 대기" : "접수" };
  }
  if (t < r.transition[1]) return { mode: "blank" };
  if (t < r.submit2) return { mode: "form", issue: "after", title: typed(ISSUE_TITLE, r.title, t), link: t >= r.pasteLink, typing: within(t, [r.title[0], r.submit2]) && t < r.pasteLink };
  const a = r.analysis;
  const comments: Comment[] = [{
    id: "ai", kind: "analysis", thinking: t < a.text[0], tools: TOOLS.filter((_, index) => t >= a.tools[index]),
    text: typed(ANALYSIS, a.text, t), done: t >= a.done ? ANALYSIS_DONE : "", evidence: t >= a.text[1],
  }];
  if (t >= r.fixing) comments.push({ id: "fix", kind: "person", author: "minjun", text: FIX_COMMENT });
  const status: Status = t >= r.resolved ? "해결됨" : t >= r.fixing ? "수정 중" : "접수";
  return { mode: "issue", issue: "after", comments: t >= a.thinking ? comments : [], status };
}

// --- Capturing and the clock --------------------------------------------------

export type CaptureState = { keys: boolean; flash: number; shots: number; steps: number };
export function captureAt(t: number): CaptureState {
  const snips = t < BEATS.submit1 ? BEATS.steps : [];
  return {
    keys: snips.some((at) => within(t, [at, at + SNIP_DELAY])),
    flash: Math.max(0, ...snips.map((at) => 1 - Math.abs(t - (at + SNIP_DELAY)) / 0.12)),
    shots: BEATS.steps.filter((at) => t >= at + PASTE_AFTER).length,
    steps: BEATS.steps.filter((at) => t >= at + TYPE_SPAN[1]).length,
  };
}

export const BEFORE_SECONDS = 18 * 60 + 40;
export const AFTER_SECONDS = 12;
// Filing time: fast-forwarded before, real time after.
export function clockAt(t: number): number {
  const r = BEATS;
  if (t < r.transition[0]) return Math.round(BEFORE_SECONDS * Math.min(1, Math.max(0, (t - r.steps[0]) / (QUESTIONS[1].at - r.steps[0]))));
  if (t < r.pip) return 0;
  return Math.round(AFTER_SECONDS * Math.min(1, (t - r.pip) / (r.submit2 - r.pip)));
}
export const formatClock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

// --- PiP ----------------------------------------------------------------------

export type PipState = { visible: boolean; minimized: boolean; link: boolean; exporting: boolean; exported: boolean; copied: boolean; quickPressed: boolean };
export function pipAt(t: number): PipState {
  const r = BEATS;
  return {
    visible: t >= r.pip && t < r.board,
    minimized: t < r.quickLink + 0.05 || t >= r.pipMinimize,
    link: t >= r.quickLink + 0.05,
    exporting: within(t, r.exporting),
    exported: t >= r.exported,
    copied: t >= r.copy + 0.05,
    quickPressed: within(t, [r.quickLink - 0.06, r.quickLink + 0.05]),
  };
}

// --- Comparison board -----------------------------------------------------------

export const COMPARISON: { label: string; before: string; after: string }[] = [
  { label: "이슈 작성 시간", before: formatClock(BEFORE_SECONDS), after: formatClock(AFTER_SECONDS) },
  { label: "첨부 스크린샷", before: "6장", after: "0장" },
  { label: "재현 절차 작성", before: "6단계 수기", after: "기록 링크 1개" },
  { label: "개발자 추가 질문", before: "2회", after: "0회" },
  { label: "재현 확인", before: "재현 안 됨", after: "즉시 확인" },
];
export const boardRowsAt = (t: number) => t < BEATS.board ? 0 : Math.min(COMPARISON.length, Math.floor((t - BEATS.board) / 0.35) + 1);

// --- Pointer, keys, captions, sound ----------------------------------------------

const CURSOR_KEYS: CursorKey[] = [
  { t: 0, x: 640, y: 560 },
  { t: 0.45, ...COUPON_BUTTON },
  { t: 0.75, ...COUPON_BUTTON },
  { t: 1.25, ...SHIP_BUTTON },
  { t: 1.55, ...SHIP_BUTTON },
  { t: 1.85, ...MODAL_SAVE },
  { t: 2.15, ...MODAL_SAVE },
  { t: 2.6, ...TOTAL_POINT },
  { t: 4.9, ...TOTAL_POINT },
  { t: 5.3, ...STEPS_AREA },
  { t: 14.8, ...STEPS_AREA },
  { t: 15.95, ...SUBMIT },
  { t: 17.9, ...SUBMIT },
  { t: 18.1, ...INPUT_TARGET },
  { t: 19, ...INPUT_TARGET },
  { t: 19.15, ...SEND_BUTTON },
  { t: 23.5, ...SEND_BUTTON },
  { t: 23.7, ...QUICK_LINK },
  { t: 23.9, ...QUICK_LINK },
  { t: 24.3, ...PIP_EXPORT },
  { t: 25.4, ...PIP_EXPORT },
  { t: 25.7, ...COPY_BUTTON },
  { t: 25.9, ...COPY_BUTTON },
  { t: 26.15, ...TITLE_FIELD },
  { t: 27.2, ...TITLE_FIELD },
  { t: 27.45, ...REPRO_FIELD },
  { t: 27.9, ...REPRO_FIELD },
  { t: 28.3, ...SUBMIT },
  { t: 28.8, ...SUBMIT },
  { t: 29.6, x: 640, y: 560 },
  { t: DURATION, x: 640, y: 560 },
];

export const CLICKS = [
  BEATS.couponClick, BEATS.shipClick, BEATS.modalSave, BEATS.submit1, BEATS.send1,
  BEATS.quickLink, BEATS.pipExport, BEATS.copy, BEATS.titleClick, BEATS.reproClick, BEATS.submit2,
].sort((a, b) => a - b);
export const cursorAt = (t: number) => pointerAt(CURSOR_KEYS, CLICKS, [], t);

export function keysAt(t: number): { keys: string[]; note?: string } | null {
  const capture = captureAt(t);
  if (capture.keys) return { keys: ["⊞ Win", "Shift", "S"], note: `스크린샷 ${capture.shots + 1}` };
  if (t < BEATS.submit1 && BEATS.steps.some((at) => within(t, [at + PASTE_AFTER - 0.1, at + PASTE_AFTER + 0.15]))) return { keys: ["Ctrl", "V"] };
  if (within(t, [BEATS.pasteLink - 0.1, BEATS.pasteLink + 0.3])) return { keys: ["Ctrl", "V"], note: "재현 기록 링크" };
  return null;
}

export const CAPTIONS: Caption[] = [
  { text: "쿠폰을 적용하고(−9,800원), 배송지를 바꿔 본다", start: 0.2, end: 2.0 },
  { text: "버그: 쿠폰은 '적용됨'인데 결제 금액이 할인 전으로 돌아감", start: 2.1, end: 5.1 },
  { text: "단계마다 캡처하고, 붙여넣고, 설명을 쓴다", start: 5.6, end: 14.9 },
  { text: "환경 정보까지 채워서 등록", start: 15, end: 16.7 },
  { text: "그래도 돌아오는 추가 질문", start: 16.8, end: 19.9 },
  { text: "18분 40초 · 스크린샷 6장 · 결국 재현 실패", start: 20, end: 22.1 },
  { text: "이미 기록된 30초를 링크로 첨부", start: 23.2, end: 28.3 },
  { text: "개발자의 AI가 링크만으로 재현을 확인", start: 29, end: 32.7 },
  { text: "질문 없이 바로 수정", start: 32.8, end: 34.7 },
  { text: "재현 절차는 쓰는 것이 아니라, 공유하는 것", start: 35, end: 40.8 },
];
export const captionAt = (t: number) => captionIn(CAPTIONS, t);

export const SOUND_CUES: { at: number; sound: CueSound }[] = [
  ...CLICKS.map((at) => ({ at, sound: "click" as const })),
  ...BEATS.steps.map((at) => ({ at: at + SNIP_DELAY, sound: "shutter" as const })),
  ...BEATS.steps.map((at) => ({ at: at + PASTE_AFTER, sound: "pop" as const })),
  ...QUESTIONS.map((question) => ({ at: question.at, sound: "pop" as const })),
  { at: BEATS.transition[0], sound: "whoosh" },
  { at: BEATS.pip, sound: "pop" },
  { at: BEATS.exported, sound: "pop" },
  { at: BEATS.pasteLink, sound: "pop" },
  { at: BEATS.analysis.text[1], sound: "ding" },
  { at: BEATS.resolved, sound: "ding" },
  { at: BEATS.board, sound: "whoosh" },
];

export const TYPING: [number, number][] = [
  ...BEATS.steps.map((at) => [at + TYPE_SPAN[0], at + TYPE_SPAN[1]] as [number, number]),
  [...BEATS.environment], [...BEATS.reply], [...BEATS.title],
];

