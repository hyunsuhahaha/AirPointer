// Script for the coding instructor usage example. Commands fly by during a
// live class and a `clear` wipes them; the class chat floods with "what was
// that command?". One Agent Link of the last 3 minutes, pinned in the chat,
// lets every student replay the same screen, and the questions resolve.
// Everything is a pure function of the playhead `t`.

import { INPUT_TARGET, SEND_BUTTON, captionAt as captionIn, pointerAt, typed, within } from "./usage-example-timeline.ts";
import type { Caption, CueSound, CursorKey } from "./usage-example-timeline.ts";

export const DURATION = 38;
export const SPEED = 1.25;

export const WORK = { x: 40, y: 70, width: 720, height: 600 };
const TERMINAL_POINT = { x: WORK.x + 420, y: WORK.y + 300 };
const REST = { x: WORK.x + 600, y: WORK.y + 520 };

export const PIP = { x: 70, y: 236, width: 560, height: 424 };
export const QUICK_LINK = { x: PIP.x + 190 + 36, y: PIP.y + PIP.height - 78 + 30 + 24 };
export const PIP_EXPORT = { x: PIP.x + 280, y: PIP.y + 150 };
export const COPY_BUTTON = { x: PIP.x + 280, y: PIP.y + 390 };

export const STUDENTS_TOTAL = 32;
export const LINK_URL = "https://whatwas.vercel.app/context/Lp5wN3cQz8HyRt1Mx4Ke_bD7vJaU2sFg9oXi6TqWnm/agent";
export const NOTICE = `방금 3분 화면 기록이에요. 오늘 친 명령어는 전부 여기서 확인하세요 👉 ${LINK_URL}`;

// The live-coding session: each command is typed, then its output appears.
export const COMMANDS: { cmd: string; label: string; typing: [number, number]; output: string[]; outputAt: number }[] = [
  { cmd: "npm create vite@latest todo -- --template react-ts", label: "vite 생성", typing: [0.3, 1.2], output: ["✔ Scaffolding project in ./todo", "Done. Now run: cd todo"], outputAt: 1.3 },
  { cmd: "cd todo && npm i", label: "의존성 설치", typing: [1.7, 2.2], output: ["added 214 packages in 6s"], outputAt: 2.4 },
  { cmd: "npm i -D tailwindcss @tailwindcss/vite", label: "tailwind", typing: [2.8, 3.7], output: ["added 12 packages in 2s"], outputAt: 3.9 },
  { cmd: "npx shadcn@latest init -d", label: "shadcn init", typing: [4.3, 5.1], output: ["✔ Writing components.json", "✔ Updated src/index.css"], outputAt: 5.3 },
  { cmd: "npx shadcn@latest add button card", label: "컴포넌트 추가", typing: [5.7, 6.5], output: ["✔ Created 2 files"], outputAt: 6.7 },
  { cmd: "npm run dev", label: "개발 서버", typing: [7.1, 7.5], output: ["VITE v6.0.3  ready in 412 ms", "➜  Local: http://localhost:5173/"], outputAt: 7.7 },
];

export const BEATS = {
  clearTyping: [8.3, 8.6],
  cleared: 8.8,
  replyTyping: [12.0, 13.4],
  reply: 13.6,
  scroll: [14.5, 16.1],
  pip: 16.8,
  quickLink: 17.4,
  pipExport: 18.0,
  exporting: [18.1, 18.9],
  exported: 19.0,
  copy: 19.6,
  inputClick: 20.0,
  paste: 20.2,
  pipMinimize: 20.5,
  send: 20.9,
  shared: [21.8, 31.0],
  replay: [22.4, 26.6],
  viewers: [22.0, 26.0],
  resolved: 26.5,
  board: 31.5,
  end: DURATION,
} as const;

// --- Terminal -------------------------------------------------------------------

export type TerminalLine = { text: string; kind: "cmd" | "out" | "hint"; typing?: boolean };
export function terminalAt(t: number): TerminalLine[] {
  if (t >= BEATS.cleared) {
    const lines: TerminalLine[] = [{ text: "$ ", kind: "cmd", typing: t < BEATS.scroll[0] }];
    if (within(t, BEATS.scroll)) lines.push({ text: "↑ 스크롤해도 clear 이전 기록이 없음", kind: "hint" });
    return lines;
  }
  const lines: TerminalLine[] = [];
  for (const command of COMMANDS) {
    if (t < command.typing[0]) break;
    lines.push({ text: `$ ${typed(command.cmd, command.typing, t)}`, kind: "cmd", typing: t < command.typing[1] });
    if (t >= command.outputAt) lines.push(...command.output.map((text) => ({ text, kind: "out" as const })));
  }
  if (t >= BEATS.clearTyping[0]) lines.push({ text: `$ ${typed("clear", BEATS.clearTyping, t)}`, kind: "cmd", typing: true });
  return lines;
}

// --- Chat -------------------------------------------------------------------------

export const QUESTIONS: { id: string; name: string; color: string; at: number; text: string }[] = [
  { id: "q1", name: "하린", color: "#6366f1", at: 9.6, text: "선생님 아까 tailwind 설치 명령어 뭐였죠?" },
  { id: "q2", name: "도현", color: "#0ea5e9", at: 10.3, text: "vite 템플릿 이름 다시 알려주실 수 있나요?" },
  { id: "q3", name: "서윤", color: "#f59e0b", at: 10.9, text: "shadcn init 뒤에 옵션 뭐 붙이셨어요?" },
  { id: "q4", name: "지안", color: "#10b981", at: 11.6, text: "cd 하고 나서 뭐 치셨는지 놓쳤어요" },
  { id: "q5", name: "민재", color: "#ec4899", at: 12.4, text: "@tailwindcss/vite 맞나요? 에러나요" },
  { id: "q6", name: "유나", color: "#8b5cf6", at: 13.1, text: "add 뒤에 컴포넌트 두 개 뭐였죠?" },
  { id: "q7", name: "태오", color: "#14b8a6", at: 13.9, text: "clear 하시기 전 화면 한 번만 다시 보여주세요 🙏" },
];
export const REPLY = "npm i -D tailwindcss @tailwindcss/vite";
export const REACTIONS: { id: string; name: string; color: string; at: number; text: string }[] = [
  { id: "a1", name: "하린", color: "#6366f1", at: 24.0, text: "찾았어요! 명령어 그대로 복사했습니다" },
  { id: "a2", name: "서윤", color: "#f59e0b", at: 25.0, text: "순서까지 보이니까 따라가기 훨씬 편하네요" },
  { id: "a3", name: "태오", color: "#14b8a6", at: 26.1, text: "clear 전에 치신 것도 다 있네요. 감사합니다" },
];

export type ChatEntry =
  | { id: string; kind: "student"; name: string; color: string; text: string; resolved: boolean }
  | { id: string; kind: "teacher"; text: string }
  | { id: string; kind: "notice"; text: string };

export function chatAt(t: number): { entries: ChatEntry[]; pinned: boolean; unanswered: number } {
  const timed: { at: number; entry: ChatEntry }[] = [];
  for (const question of QUESTIONS) if (t >= question.at) {
    timed.push({ at: question.at, entry: { id: question.id, kind: "student", name: question.name, color: question.color, text: question.text, resolved: t >= BEATS.resolved || (question.id === "q1" && t >= BEATS.reply) } });
  }
  if (t >= BEATS.reply) timed.push({ at: BEATS.reply, entry: { id: "t1", kind: "teacher", text: REPLY } });
  if (t >= BEATS.send) timed.push({ at: BEATS.send, entry: { id: "n1", kind: "notice", text: NOTICE } });
  for (const reaction of REACTIONS) if (t >= reaction.at) {
    timed.push({ at: reaction.at, entry: { id: reaction.id, kind: "student", name: reaction.name, color: reaction.color, text: reaction.text, resolved: false } });
  }
  timed.sort((left, right) => left.at - right.at);
  const asked = QUESTIONS.filter((question) => t >= question.at).length;
  const unanswered = t >= BEATS.resolved ? 0 : Math.max(0, asked - (t >= BEATS.reply ? 1 : 0));
  return { entries: timed.map((item) => item.entry), pinned: t >= BEATS.send, unanswered };
}

export function chatInputAt(t: number): { text: string; typing: boolean } {
  if (within(t, [BEATS.replyTyping[0], BEATS.reply])) return { text: typed(REPLY, BEATS.replyTyping, t), typing: true };
  if (within(t, [BEATS.paste, BEATS.send])) return { text: NOTICE, typing: false };
  return { text: "", typing: false };
}

// --- Shared screen ------------------------------------------------------------------

export const sharedAt = (t: number) => within(t, BEATS.shared);
export function replayIndexAt(t: number) {
  const [start, end] = BEATS.replay;
  const u = Math.min(1, Math.max(0, (t - start) / (end - start)));
  return Math.min(COMMANDS.length - 1, Math.floor(u * COMMANDS.length));
}
export const VIEWERS_MAX = 28;
export function viewersAt(t: number) {
  const [start, end] = BEATS.viewers;
  const u = Math.min(1, Math.max(0, (t - start) / (end - start)));
  return Math.round(VIEWERS_MAX * (1 - (1 - u) ** 2));
}

// --- PiP ----------------------------------------------------------------------------

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

// --- Board ---------------------------------------------------------------------------

export const COMPARISON: { label: string; before: string; after: string }[] = [
  { label: "같은 질문", before: "7개", after: "0개" },
  { label: "개별 답장", before: "7번", after: "공지 1번" },
  { label: "수업 중단", before: "약 6분", after: "0분" },
  { label: "지나간 화면 다시 보기", before: "불가 (clear)", after: "최근 3분 전체" },
];
export const boardRowsAt = (t: number) => t < BEATS.board ? 0 : Math.min(COMPARISON.length, Math.floor((t - BEATS.board) / 0.35) + 1);

// --- Pointer, keys, captions, sound ---------------------------------------------------

const CURSOR_KEYS: CursorKey[] = [
  { t: 0, ...REST },
  { t: 11.5, ...REST },
  { t: 11.9, ...INPUT_TARGET },
  { t: 13.45, ...INPUT_TARGET },
  { t: 13.55, ...SEND_BUTTON },
  { t: 13.7, ...SEND_BUTTON },
  { t: 14.3, ...TERMINAL_POINT },
  { t: 16.2, ...TERMINAL_POINT },
  { t: 17.3, ...QUICK_LINK },
  { t: 17.5, ...QUICK_LINK },
  { t: 17.9, ...PIP_EXPORT },
  { t: 19.1, ...PIP_EXPORT },
  { t: 19.5, ...COPY_BUTTON },
  { t: 19.7, ...COPY_BUTTON },
  { t: 19.95, ...INPUT_TARGET },
  { t: 20.4, ...INPUT_TARGET },
  { t: 20.85, ...SEND_BUTTON },
  { t: 21.5, ...SEND_BUTTON },
  { t: 22.2, ...REST },
  { t: DURATION, ...REST },
];

export const CLICKS = [BEATS.reply, BEATS.quickLink, BEATS.pipExport, BEATS.copy, BEATS.inputClick, BEATS.send];
export const cursorAt = (t: number) => pointerAt(CURSOR_KEYS, CLICKS, [], t);

export function keysAt(t: number): { keys: string[]; note?: string } | null {
  if (within(t, [BEATS.cleared - 0.2, BEATS.cleared + 0.25])) return { keys: ["Enter"], note: "clear" };
  if (within(t, [BEATS.scroll[0], BEATS.scroll[0] + 0.9])) return { keys: ["Ctrl", "↑"], note: "터미널 위로" };
  if (within(t, [BEATS.paste - 0.1, BEATS.paste + 0.3])) return { keys: ["Ctrl", "V"], note: "공지에 링크" };
  return null;
}

export const CAPTIONS: Caption[] = [
  { text: "라이브 코딩 수업 · 명령어가 빠르게 지나간다", start: 0.2, end: 8.2 },
  { text: "…그리고 clear. 화면에서 전부 사라졌다", start: 8.3, end: 10.0 },
  { text: "“아까 그 명령어 뭐였죠?” 질문이 쏟아진다", start: 10.1, end: 13.5 },
  { text: "하나씩 다시 쳐서 답해도 끝이 없고, 터미널엔 기록이 없다", start: 13.6, end: 16.5 },
  { text: "방금그거뭐였지 2번 → 최근 3분을 링크 하나로 공지", start: 16.6, end: 21.7 },
  { text: "수강생 전원이 같은 화면을 다시 본다", start: 21.8, end: 26.8 },
  { text: "미답변 질문 0 · 수업은 멈추지 않는다", start: 26.9, end: 31.3 },
  { text: "지나간 화면도, 모두가 다시 볼 수 있게", start: 31.8, end: 37.8 },
];
export const captionAt = (t: number) => captionIn(CAPTIONS, t);

export const SOUND_CUES: { at: number; sound: CueSound }[] = [
  ...CLICKS.map((at) => ({ at, sound: "click" as const })),
  { at: BEATS.cleared, sound: "swish" },
  ...QUESTIONS.map((question) => ({ at: question.at, sound: "pop" as const })),
  { at: BEATS.pip, sound: "pop" },
  { at: BEATS.exported, sound: "pop" },
  { at: BEATS.send + 0.1, sound: "ding" },
  ...REACTIONS.map((reaction) => ({ at: reaction.at, sound: "pop" as const })),
  { at: BEATS.resolved, sound: "ding" },
  { at: BEATS.board, sound: "whoosh" },
];

export const TYPING: [number, number][] = [...COMMANDS.map((command) => command.typing), [...BEATS.clearTyping], [...BEATS.replyTyping]];
