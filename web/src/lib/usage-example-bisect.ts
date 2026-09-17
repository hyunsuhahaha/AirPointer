// Script for the vibe coder usage example (Local Folder). An AI agent edits the
// landing page twelve times in five minutes and the sign-up button vanishes
// somewhere along the way. A video would show when, never which edit. The
// saved Local Folder has timestamped screen changes; a local agent lines them
// up with the file-save times on this PC, finds edit 7 and reverts just that
// line. Everything is a pure function of the playhead `t`.

import { INPUT_TARGET, SEND_BUTTON, captionAt as captionIn, pointerAt, typed, within } from "./usage-example-timeline.ts";
import type { Caption, CueSound, CursorKey } from "./usage-example-timeline.ts";

export const DURATION = 36;
export const SPEED = 1.25;

export const WORK = { x: 40, y: 70, width: 720, height: 600 };
export const PREVIEW_HEIGHT = 372;
// The timeline sits on top so the minimized PiP bar floats over the page, not the rows.
export const PREVIEW_TOP = 228;
// The CTA inside the preview (work-area units), where the button used to be.
export const CTA = { x: 250, y: PREVIEW_TOP + 226, width: 220, height: 48 };
const CTA_POINT = { x: WORK.x + CTA.x + CTA.width / 2, y: WORK.y + CTA.y + CTA.height / 2 };
const REST = { x: WORK.x + 600, y: WORK.y + 300 };

// The timeline panel under the preview maps five minutes onto its width.
export const TIMELINE = { left: 60, width: 620, top: 0, height: 208, fileRow: 148, screenRow: 78 };
export const WINDOW_SECONDS = 300;
export const timelineX = (seconds: number) => TIMELINE.left + (TIMELINE.width * seconds) / WINDOW_SECONDS;
export const clockLabel = (seconds: number) => {
  const whole = Math.floor(seconds);
  const ms = Math.round((seconds - whole) * 10);
  return `14:${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}${ms ? `.${ms}` : ""}`;
};

export const PIP = { x: 70, y: 236, width: 560, height: 424 };
export const QUICK_FOLDER = { x: PIP.x + 190 + 62, y: PIP.y + PIP.height - 78 + 30 + 24 };
export const RANGE_CHIPS = ["최근 1분", "최근 3분", "최근 5분"] as const;
export const rangeChip = (index: number) => ({ x: PIP.x + 16 + 50 + index * 108, y: PIP.y + 128 });
export const EXPORT_BUTTON = { x: PIP.x + 280, y: PIP.y + 184 };
export const COPY_BUTTON = { x: PIP.x + 280, y: PIP.y + 390 };

export const FOLDER = "Documents/Context-2026-09-17T14-05-02";
export const FOLDER_PROMPT = `로컬 파일시스템에서 저장 경로가 "${FOLDER}"로 끝나는 폴더를 찾아 주세요. context.md와 events.json을 읽은 뒤 captures 폴더의 화면을 시간순으로 확인해서 제가 무엇을 하고 있었는지 파악해 주세요. 가입 버튼이 사라진 순간의 수정을 찾아 주세요.`;
export const TASK = "랜딩 페이지 좀 다듬어줘";
export const QUESTION = "가입 버튼 사라졌는데 몇 번째 수정 때문이야?";

// The twelve edits: when they happen on screen (t) and on the virtual clock.
export const EDITS: { t: number; seconds: number; file: string; summary: string }[] = [
  { t: 2.0, seconds: 12, file: "Hero.tsx", summary: "헤드라인 문구 다듬기" },
  { t: 2.55, seconds: 38, file: "theme.css", summary: "강조색 조정" },
  { t: 3.1, seconds: 61, file: "Nav.tsx", summary: "메뉴 간격 정리" },
  { t: 3.65, seconds: 85, file: "Hero.module.css", summary: "헤드라인 크기 키우기" },
  { t: 4.2, seconds: 117, file: "Features.tsx", summary: "기능 카드 3개 정렬" },
  { t: 4.75, seconds: 160, file: "theme.css", summary: "배경 그라데이션" },
  { t: 5.3, seconds: 220.9, file: "Hero.module.css", summary: "CTA 여백 정리" },
  { t: 5.85, seconds: 238, file: "Footer.tsx", summary: "푸터 링크 추가" },
  { t: 6.4, seconds: 251, file: "Hero.tsx", summary: "보조 문구 추가" },
  { t: 6.95, seconds: 266, file: "theme.css", summary: "그림자 부드럽게" },
  { t: 7.5, seconds: 280, file: "Nav.tsx", summary: "로고 크기" },
  { t: 8.05, seconds: 292, file: "Features.tsx", summary: "아이콘 교체" },
];
export const BREAKING_EDIT = 6;
export const REFRESH_DELAY = 0.3;
export const BREAK_SCREEN_SECONDS = EDITS[BREAKING_EDIT].seconds + REFRESH_DELAY;
// Screen changes with a thumbnail on the timeline (edit indices).
export const SCREEN_MARKS = [0, 2, 4, 5, 6, 9, 11];

export const BEATS = {
  task: [0.3, 1.3],
  taskSend: 1.6,
  notice: [8.2, 10.8],
  question: [9.7, 10.6],
  ask: 10.9,
  reply: { thinking: 11.1, text: [11.3, 12.3] },
  clueless: [12.4, 13.8],
  quickFolder: 14.0,
  range: 14.6,
  exportClick: 15.2,
  exporting: [15.3, 16.4],
  exported: 16.5,
  copy: 16.9,
  pipMinimize: 17.1,
  agentClick: 17.3,
  paste: 17.5,
  enter: 17.9,
  steps: [18.5, 19.4, 20.4, 21.4, 22.6, 24.2, 25.4],
  screenRow: 19.4,
  link: 21.4,
  fixed: 26.4,
  summary: [26.6, 28.6],
  board: 29.6,
  end: DURATION,
} as const;

// --- Preview and timeline -------------------------------------------------------------

export type PreviewState = { edits: number; ctaVisible: boolean; refreshing: boolean; hue: number; headline: number; notice: boolean; fixed: boolean };
export function previewAt(t: number): PreviewState {
  const edits = EDITS.filter((edit) => t >= edit.t).length;
  const fixed = t >= BEATS.fixed;
  return {
    edits,
    ctaVisible: fixed || edits <= BREAKING_EDIT,
    refreshing: EDITS.some((edit) => within(t, [edit.t, edit.t + 0.2])) || within(t, [BEATS.fixed, BEATS.fixed + 0.2]),
    hue: 245 - Math.min(edits, 6) * 7,
    headline: 34 + Math.min(edits, 4) * 2,
    notice: within(t, BEATS.notice),
    fixed,
  };
}

export type TimelineState = { saves: number; screen: boolean; link: boolean; reverted: boolean; clueless: boolean };
export const timelineAt = (t: number): TimelineState => ({
  saves: EDITS.filter((edit) => t >= edit.t).length,
  clueless: within(t, BEATS.clueless),
  screen: t >= BEATS.screenRow,
  link: t >= BEATS.link,
  reverted: t >= BEATS.fixed,
});

// --- Agent chat -------------------------------------------------------------------------

export const REPLY_1 = "12개 수정 중 가입 버튼 코드를 직접 바꾼 건 없어요. 저는 화면을 보지 못해서, 몇 번째 수정 뒤에 버튼이 사라졌는지는 알 수 없습니다.";
// While nobody knows, the pointer wanders over the save markers: this one? that one?
const SAVE_Y = WORK.y + 148;
const saveAt = (index: number) => ({ x: WORK.x + timelineX(EDITS[index].seconds), y: SAVE_Y });
export type AgentStep = { tool: string; detail: string; kind?: "find" | "local" | "match" | "edit" | "ok" };
export const AGENT_STEPS: AgentStep[] = [
  { tool: "Read", detail: "events.json · 화면 변화 31건 (최근 5분)" },
  { tool: "Read", detail: `captures · ${clockLabel(BREAK_SCREEN_SECONDS)} 전후 비교 → 가입 버튼 사라짐`, kind: "find" },
  { tool: "Bash", detail: "에디터 로컬 기록 · 파일 저장 12건과 시각 수집", kind: "local" },
  { tool: "Match", detail: `${clockLabel(EDITS[BREAKING_EDIT].seconds)} Hero.module.css 저장 → 0.3초 뒤 화면 변화 · 7번째 수정`, kind: "match" },
  { tool: "Read", detail: "7번째 수정 diff · Hero.module.css", kind: "edit" },
  { tool: "Edit", detail: "그 한 줄만 되돌림 · 나머지 11개 수정 유지", kind: "local" },
  { tool: "Check", detail: "localhost:3000 새로고침 → 가입 버튼 다시 보임", kind: "ok" },
];
export const SUMMARY = "7번째 수정(CTA 여백 정리)에서 .cta에 overflow: hidden과 height: 0이 함께 들어가 버튼이 가려졌어요. 그 한 줄만 되돌렸고, 다른 11개 개선은 그대로 두었습니다.";

export type AgentLine =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "edit"; index: number }
  | { id: string; kind: "reply"; text: string; thinking: boolean }
  | { id: string; kind: "step"; step: AgentStep }
  | { id: string; kind: "summary"; text: string };

export function agentAt(t: number): { lines: AgentLine[]; input: string; typing: boolean; running: boolean } {
  const r = BEATS;
  const lines: AgentLine[] = [];
  if (t >= r.taskSend) lines.push({ id: "task", kind: "user", text: TASK });
  EDITS.forEach((edit, index) => { if (t >= edit.t) lines.push({ id: `e${index}`, kind: "edit", index }); });
  if (t >= r.ask) lines.push({ id: "ask", kind: "user", text: QUESTION });
  if (t >= r.reply.thinking) lines.push({ id: "r1", kind: "reply", text: typed(REPLY_1, r.reply.text, t), thinking: t < r.reply.text[0] });
  if (t >= r.enter) lines.push({ id: "prompt", kind: "user", text: FOLDER_PROMPT });
  AGENT_STEPS.forEach((step, index) => { if (t >= r.steps[index]) lines.push({ id: `s${index}`, kind: "step", step }); });
  if (t >= r.summary[0]) lines.push({ id: "summary", kind: "summary", text: typed(SUMMARY, r.summary, t) });
  let input = "";
  if (within(t, [r.task[0], r.taskSend])) input = typed(TASK, r.task, t);
  if (within(t, [r.question[0], r.ask])) input = typed(QUESTION, r.question, t);
  else if (within(t, [r.paste, r.enter])) input = FOLDER_PROMPT;
  return {
    lines, input,
    typing: within(t, [r.task[0], r.taskSend]) || within(t, [r.question[0], r.ask]),
    running: (t >= EDITS[0].t && t < EDITS[EDITS.length - 1].t + 0.4) || (t >= r.enter && t < r.summary[0]),
  };
}

// --- PiP ----------------------------------------------------------------------------------

export type PipState = { visible: boolean; minimized: boolean; folder: boolean; range: number; exporting: number | null; exported: boolean; copied: boolean; quickPressed: boolean };
export function pipAt(t: number): PipState {
  const r = BEATS;
  return {
    visible: t < r.board,
    minimized: t < r.quickFolder + 0.05 || t >= r.pipMinimize,
    folder: t >= r.quickFolder + 0.05,
    range: t >= r.range ? 2 : 1,
    exporting: within(t, r.exporting) ? (t - r.exporting[0]) / (r.exporting[1] - r.exporting[0]) : null,
    exported: t >= r.exported,
    copied: t >= r.copy + 0.05,
    quickPressed: within(t, [r.quickFolder - 0.06, r.quickFolder + 0.05]),
  };
}
export const FRAMES_SAVED = 300;

// --- Board --------------------------------------------------------------------------------

export const COMPARISON: { label: string; before: string; after: string }[] = [
  { label: "알 수 있는 것", before: "언제 깨졌는지", after: "어느 수정이 깨뜨렸는지" },
  { label: "시간을 맞춰볼 기록", before: "없음", after: "파일 저장 12건" },
  { label: "되돌린 수정", before: "12개를 하나씩", after: "1줄" },
  { label: "나머지 11개 개선", before: "같이 날아가기 쉬움", after: "그대로 유지" },
];
export const boardRowsAt = (t: number) => t < BEATS.board ? 0 : Math.min(COMPARISON.length, Math.floor((t - BEATS.board) / 0.35) + 1);

// --- Pointer, keys, captions, sound --------------------------------------------------------

const CURSOR_KEYS: CursorKey[] = [
  { t: 0, ...INPUT_TARGET },
  { t: 1.3, ...INPUT_TARGET },
  { t: 1.55, ...SEND_BUTTON },
  { t: 1.8, ...SEND_BUTTON },
  { t: 2.4, ...REST },
  { t: 8.1, ...REST },
  { t: 8.5, ...CTA_POINT },
  { t: 9.3, ...CTA_POINT },
  { t: 9.6, ...INPUT_TARGET },
  { t: 10.7, ...INPUT_TARGET },
  { t: 10.85, ...SEND_BUTTON },
  { t: 12.4, ...SEND_BUTTON },
  { t: 12.75, ...saveAt(0) },
  { t: 13.05, ...saveAt(4) },
  { t: 13.35, ...saveAt(11) },
  { t: 13.6, ...saveAt(8) },
  { t: 13.9, ...QUICK_FOLDER },
  { t: 14.1, ...QUICK_FOLDER },
  { t: 14.45, ...rangeChip(2) },
  { t: 14.7, ...rangeChip(2) },
  { t: 15.1, ...EXPORT_BUTTON },
  { t: 16.6, ...EXPORT_BUTTON },
  { t: 16.8, ...COPY_BUTTON },
  { t: 17.0, ...COPY_BUTTON },
  { t: 17.25, ...INPUT_TARGET },
  { t: 18.2, ...INPUT_TARGET },
  { t: 18.9, ...REST },
  { t: DURATION, ...REST },
];
export const CLICKS = [BEATS.taskSend, BEATS.ask, BEATS.quickFolder, BEATS.range, BEATS.exportClick, BEATS.copy, BEATS.agentClick];
export const cursorAt = (t: number) => pointerAt(CURSOR_KEYS, CLICKS, [], t);

export function keysAt(t: number): { keys: string[]; note?: string } | null {
  if (within(t, [BEATS.paste - 0.1, BEATS.paste + 0.3])) return { keys: ["Ctrl", "V"], note: "폴더 경로 프롬프트" };
  if (within(t, [BEATS.enter - 0.1, BEATS.enter + 0.25])) return { keys: ["Enter"] };
  return null;
}

export const CAPTIONS: Caption[] = [
  { text: "코딩 AI에게 한 줄 부탁: “랜딩 페이지 좀 다듬어줘”", start: 0.2, end: 2.4 },
  { text: "AI가 알아서 5분 동안 파일을 12번 고친다", start: 2.5, end: 5.2 },
  { text: "…그 사이 어딘가에서", start: 5.3, end: 8.1 },
  { text: "끝나고 보니 가입 버튼이 없다", start: 8.2, end: 10.8 },
  { text: "AI도 모르고, 나도 모른다", start: 10.9, end: 12.4 },
  { text: "1번? 5번? 12번?… 대체 몇 번째 수정이야", start: 12.4, end: 13.7 },
  { text: "방금그거뭐였지 3번 → 최근 5분을 내 PC 폴더에 저장", start: 13.8, end: 18.2 },
  { text: "기록에서 화면이 바뀐 시각을 찾고", start: 18.4, end: 21.3 },
  { text: "내 PC의 파일 저장 시각과 겹치면: 7번째 수정", start: 21.4, end: 25.3 },
  { text: "그 한 줄만 되돌리고, 나머지 11개는 그대로", start: 25.4, end: 29.4 },
  { text: "화면 기록 × 내 PC 작업 기록, 시간으로 겹쳐 원인을 찾는다", start: 29.8, end: 35.8 },
];
export const captionAt = (t: number) => captionIn(CAPTIONS, t);

export const SOUND_CUES: { at: number; sound: CueSound }[] = [
  ...CLICKS.map((at) => ({ at, sound: "click" as const })),
  ...EDITS.map((edit) => ({ at: edit.t, sound: "pop" as const })),
  { at: BEATS.notice[0], sound: "boing" },
  { at: BEATS.clueless[0], sound: "boing" },
  { at: BEATS.exported, sound: "pop" },
  { at: BEATS.enter, sound: "whoosh" },
  { at: BEATS.link, sound: "ding" },
  { at: BEATS.fixed, sound: "ding" },
  { at: BEATS.board, sound: "whoosh" },
];

export const TYPING: [number, number][] = [[...BEATS.task], [...BEATS.question]];
