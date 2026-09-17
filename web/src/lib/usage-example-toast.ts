// Script for the "안 눌리는 버튼" usage example. After saving, a toast fades
// out with opacity only, so its invisible box keeps swallowing clicks on the
// export button underneath. The developer narrows it down properly (handler
// never fires, no console error, no request) and says so, yet the AI keeps
// asking for one screenshot after another and ends with "works on my
// machine". An Agent Link of the last 30 seconds shows the toast sitting on
// the button. Everything is a pure function of the playhead `t`.

import { INPUT_TARGET, SEND_BUTTON, captionAt as captionIn, pointerAt, typed, within } from "./usage-example-timeline.ts";
import type { Caption, CueSound, CursorKey } from "./usage-example-timeline.ts";

export const DURATION = 40.5;
export const SPEED = 1.25;

// Layout, in stage units. The work area holds the browser (with DevTools
// docked below the page once opened) or the editor.
export const WORK = { x: 40, y: 70, width: 720, height: 600 };
export const DEVTOOLS_TOP = WORK.y + 340;
export const SAVE_BUTTON = { x: WORK.x + 100, y: WORK.y + 290 };
export const EXPORT_BUTTON = { x: WORK.x + 620, y: WORK.y + 290 };
// Buttons and the toast are placed against the work area (not the page
// below the address bar). The toast box covers the export button.
export const TOAST = { x: 470, y: 262, width: 230, height: 56 };
export const CONSOLE_TAB = { x: WORK.x + 128, y: DEVTOOLS_TOP + 16 };
export const NETWORK_TAB = { x: WORK.x + 208, y: DEVTOOLS_TOP + 16 };

export const PIP = { x: 70, y: 236, width: 560, height: 424 };
export const QUICK_LINK = { x: PIP.x + 190 + 36, y: PIP.y + PIP.height - 78 + 30 + 24 };
export const PIP_EXPORT = { x: PIP.x + 280, y: PIP.y + 150 };
export const COPY_BUTTON = { x: PIP.x + 280, y: PIP.y + 390 };

export const LINK_URL = "https://whatwas.vercel.app/context/k3Vn8qQ2xR7mWbT0pLc4_zY1uHs9eJdA6fNiG5oKvXw/agent";
export const LINK_PROMPT = `최근 30초 화면 기록을 확인해서 제가 무엇을 하고 있었는지 파악해 주세요. ${LINK_URL}`;
export const PROMPT_1 = "내보내기 버튼이 안 눌려. onClick 자체가 안 불리고 콘솔 에러 0, Network 요청 0. 저장 누른 다음부터 이럼";

export const BEATS = {
  saveClick: 0.9,
  toast: [1.0, 3.0],
  toastFade: 2.4,
  // A few slow clicks, a puzzled pause, then a burst: nothing happens.
  deadClicks: [3.4, 3.8, 4.2, 5.0, 5.15, 5.3, 5.45, 5.6, 5.75, 5.9, 6.05],
  puzzled: [4.35, 4.95],
  deadShake: [6.1, 6.6],
  devtools: 6.8,
  networkCheck: 7.4,
  deadClickNetwork: 7.8,
  prompt1: [8.4, 9.6],
  send1: 9.9,
  consoleTab: 13.4,
  networkTab: 16.1,
  pip: 23.8,
  quickLink: 24.4,
  pipExport: 25.1,
  exporting: [25.2, 26],
  exported: 26.1,
  copy: 26.7,
  pasteKeys: 27.4,
  pasted: 27.55,
  pipMinimize: 27.8,
  send6: 28.2,
  reply6: { thinking: 28.5, tools: [28.8, 29.2, 29.6], card: 30.1, text: [30.3, 32.4], done: 32.6, cardEnd: 34.8 },
  diff: [33.2, 34.4],
  exportWorks: 35.8,
  downloaded: 36,
  end: DURATION,
} as const;

// Each screenshot round: the AI asks, the developer snips, pastes, adds a
// short (increasingly tired) note and sends.
export type Shot = "page" | "console" | "network" | "code";
export type Round = {
  ask: string; thinking: number; text: readonly [number, number];
  shot: Shot; snip: number; paste: number; note: string; noteTyping: readonly [number, number]; send: number;
};
export const ROUNDS: Round[] = [
  { ask: "문제를 정확히 파악하기 위해 화면 스크린샷을 보여주시겠어요? 📸", thinking: 10.1, text: [10.3, 11], shot: "page", snip: 11.3, paste: 11.8, note: "여기", noteTyping: [11.85, 11.95], send: 12.1 },
  { ask: "개발자 도구 Console 탭에 에러가 있는지 확인 부탁드려요.", thinking: 12.3, text: [12.5, 13.1], shot: "console", snip: 13.7, paste: 14.2, note: "에러 없다고 했잖아", noteTyping: [14.25, 14.6], send: 14.8 },
  { ask: "버튼을 누를 때 Network 탭에 요청이 발생하는지도 보여주세요.", thinking: 15, text: [15.2, 15.8], shot: "network", snip: 16.4, paste: 16.9, note: "0건이라고…", noteTyping: [16.95, 17.2], send: 17.4 },
  { ask: "ExportButton 컴포넌트 코드도 보여주시겠어요?", thinking: 17.6, text: [17.8, 18.4], shot: "code", snip: 19, paste: 19.5, note: "여기. 핸들러 정상임", noteTyping: [19.55, 19.9], send: 20.1 },
];
export const SHOT_DELAY = 0.2;
export const VERDICT = { thinking: 20.3, text: [21.2, 22.3], card: 21.4, cardEnd: 23.6, shake: [22.4, 23] } as const;
export const REPLY_5 = "검토 결과 코드에는 문제가 없습니다. 제 환경에서는 정상 작동합니다 🙂";

const APP_SWITCHES: [number, App][] = [[0, "browser"], [18.7, "editor"], [23.5, "browser"], [33, "editor"], [35.1, "browser"]];
export type App = "browser" | "editor";
// The player can hand in a slightly negative t on its first frame.
export const appAt = (t: number): App => (APP_SWITCHES.findLast(([at]) => t >= at) ?? APP_SWITCHES[0])[1];
export const altTabAt = (t: number) => APP_SWITCHES.slice(1).some(([at]) => within(t, [at - 0.15, at + 0.25]));

// --- Browser ----------------------------------------------------------------

export type BrowserState = {
  toastOpacity: number; toastGhost: boolean; devtools: boolean; devtoolsTab: "console" | "network";
  exportRequest: boolean; downloaded: boolean; saved: boolean;
  // The dead-click beat: how many clicks went nowhere, the "무반응" marks
  // still floating up (age in seconds), and the puzzled pause.
  deadClicks: number; deadPops: { id: number; age: number }[]; puzzled: boolean;
};

export const DEAD_POP_SECONDS = 0.7;

export function browserAt(t: number): BrowserState {
  const r = BEATS;
  const tab = t >= r.networkTab || within(t, [r.networkCheck, r.consoleTab]) ? "network" : "console";
  const fading = Math.min(1, Math.max(0, (t - r.toastFade) / (r.toast[1] - r.toastFade)));
  return {
    toastOpacity: within(t, r.toast) ? 1 - fading : 0,
    // Until the fix, the faded toast keeps its box over the button.
    toastGhost: t >= r.toast[1] && t < r.diff[1],
    devtools: t >= r.devtools,
    devtoolsTab: tab,
    exportRequest: t >= r.exportWorks,
    downloaded: t >= r.downloaded,
    saved: t >= r.saveClick,
    deadClicks: t < r.devtools ? r.deadClicks.filter((at) => t >= at).length : 0,
    deadPops: r.deadClicks.flatMap((at, id) => within(t, [at, at + DEAD_POP_SECONDS]) ? [{ id, age: t - at }] : []),
    puzzled: within(t, r.puzzled),
  };
}

// --- Editor -----------------------------------------------------------------

export const EXPORT_BUTTON_CODE = [
  "export function ExportButton() {",
  "  const onClick = async () => {",
  "    const csv = await api.exportUsers();",
  "    download(csv, \"users.csv\");",
  "  };",
  "  return <Button onClick={onClick}>내보내기</Button>;",
  "}",
];

export type DiffRow = { file: string; kind: "add" | "del"; text: string };
export const DIFF_ROWS: DiffRow[] = [
  { file: "Toast.tsx", kind: "del", text: "<div className=\"toast\" style={{ opacity: visible ? 1 : 0 }}>" },
  { file: "Toast.tsx", kind: "add", text: "{visible && <div className=\"toast\">" },
  { file: "toast.css", kind: "add", text: ".toast-root { pointer-events: none; }" },
  { file: "toast.css", kind: "add", text: ".toast { pointer-events: auto; }" },
];

export type EditorState = { tabs: string[]; active: string; diffRows: number; terminal: string[] };
export function editorAt(t: number): EditorState {
  const r = BEATS;
  const fixing = t >= r.diff[0];
  const progress = Math.min(1, Math.max(0, (t - r.diff[0]) / (r.diff[1] - r.diff[0])));
  const terminal = ["$ npm run dev", "▲ Next.js 16.3 · http://localhost:3000", "✓ Ready in 812ms", "✓ Compiled /settings in 240ms"];
  if (t >= r.diff[1]) terminal.push("✓ Compiled in 188ms");
  return {
    tabs: fixing ? ["ExportButton.tsx", "Toast.tsx", "toast.css", "변경 사항"] : ["ExportButton.tsx"],
    active: fixing ? "변경 사항" : "ExportButton.tsx",
    diffRows: fixing ? Math.ceil(progress * DIFF_ROWS.length) : 0,
    terminal,
  };
}

// --- Capturing --------------------------------------------------------------

export type CaptureState = { keys: boolean; flash: number; pasted: number; minutes: number; hud: boolean };
export function captureAt(t: number): CaptureState {
  const keys = ROUNDS.some((round) => within(t, [round.snip, round.snip + SHOT_DELAY]));
  const flash = Math.max(0, ...ROUNDS.map((round) => 1 - Math.abs(t - (round.snip + SHOT_DELAY)) / 0.12));
  const pasted = ROUNDS.filter((round) => t >= round.paste).length;
  const minutes = Math.round(1 + 13 * Math.min(1, Math.max(0, (t - BEATS.send1) / (VERDICT.text[0] - BEATS.send1))));
  return { keys, flash, pasted, minutes, hud: within(t, [ROUNDS[0].paste, VERDICT.cardEnd]) };
}

// --- PiP --------------------------------------------------------------------

export type PipState = { visible: boolean; minimized: boolean; link: boolean; exporting: boolean; exported: boolean; copied: boolean; quickPressed: boolean };
export function pipAt(t: number): PipState {
  const r = BEATS;
  return {
    visible: t >= r.pip,
    minimized: t < r.quickLink + 0.05 || t >= r.pipMinimize,
    link: t >= r.quickLink + 0.05,
    exporting: within(t, r.exporting),
    exported: t >= r.exported,
    copied: t >= r.copy + 0.05,
    quickPressed: within(t, [r.quickLink - 0.06, r.quickLink + 0.05]),
  };
}

// --- Chat -------------------------------------------------------------------

export function chatInputAt(t: number): { text: string; shot: Shot | null; typing: boolean } {
  const r = BEATS;
  if (t < r.send1) return { text: typed(PROMPT_1, r.prompt1, t), shot: null, typing: within(t, [r.prompt1[0], r.send1]) };
  for (const round of ROUNDS) {
    if (within(t, [round.paste, round.send])) return { text: typed(round.note, round.noteTyping, t), shot: round.shot, typing: t >= round.noteTyping[0] };
  }
  if (within(t, [r.pasted, r.send6])) return { text: LINK_PROMPT, shot: null, typing: false };
  return { text: "", shot: null, typing: false };
}

export const pasteKeysAt = (t: number) => ROUNDS.some((round) => within(t, [round.paste - 0.1, round.paste + 0.2]))
  || within(t, [BEATS.pasteKeys, BEATS.pasteKeys + 0.4]);

export const TOOLS_6 = ["🔗 Agent Link 열기 · 최근 30초", "📋 events.json · 화면 변화 18건", "🖼 captures 12장 · 03:12:02 확대"];
export const REPLY_6 = "찾았어요. 03:12:02에 '저장되었습니다' 토스트가 정확히 내보내기 버튼 위에 떴어요. 토스트는 opacity만 0이 되고 요소가 남아서, 그 뒤의 클릭을 전부 가로채고 있습니다. 그래서 핸들러도, 에러도, 요청도 없었던 거예요.";
export const DONE_6 = "제 쪽에선 저장을 먼저 누르지 않아 재현이 안 됐네요. 사라진 토스트는 DOM에서 빼고, 컨테이너에 pointer-events: none을 넣을게요.";

export type ToastChat =
  | { id: string; role: "user"; text: string; shot: Shot | null }
  | { id: string; role: "claudy"; text: string; thinking: boolean; tools: string[]; done: string; evidence: boolean };

export function chatAt(t: number): ToastChat[] {
  const messages: ToastChat[] = [];
  if (t >= BEATS.send1) messages.push({ id: "u1", role: "user", text: PROMPT_1, shot: null });
  ROUNDS.forEach((round, index) => {
    if (t >= round.thinking) messages.push({ id: `c${index + 1}`, role: "claudy", thinking: t < round.text[0], text: typed(round.ask, round.text, t), tools: [], done: "", evidence: false });
    if (t >= round.send) messages.push({ id: `u${index + 2}`, role: "user", text: round.note, shot: round.shot });
  });
  if (t >= VERDICT.thinking) messages.push({ id: "c5", role: "claudy", thinking: t < VERDICT.text[0], text: typed(REPLY_5, VERDICT.text, t), tools: [], done: "", evidence: false });
  const r6 = BEATS.reply6;
  if (t >= BEATS.send6) messages.push({ id: "u6", role: "user", text: LINK_PROMPT, shot: null });
  if (t >= r6.thinking) messages.push({
    id: "c6", role: "claudy", thinking: t < r6.text[0], text: typed(REPLY_6, r6.text, t),
    tools: TOOLS_6.filter((_, index) => t >= r6.tools[index]), done: t >= r6.done ? DONE_6 : "", evidence: t >= r6.text[1],
  });
  return messages;
}

export const cardAt = (t: number): "dumb" | "smart" | null =>
  within(t, [VERDICT.card, VERDICT.cardEnd]) ? "dumb" : within(t, [BEATS.reply6.card, BEATS.reply6.cardEnd]) ? "smart" : null;

// --- Pointer, keys, captions, sound -----------------------------------------

const CURSOR_KEYS: CursorKey[] = [
  { t: 0, x: 640, y: 560 },
  { t: 0.75, ...SAVE_BUTTON },
  { t: 1.0, ...SAVE_BUTTON },
  { t: 3.35, ...EXPORT_BUTTON },
  { t: 4.3, ...EXPORT_BUTTON },
  { t: 4.6, x: EXPORT_BUTTON.x + 14, y: EXPORT_BUTTON.y + 10 },
  { t: 4.9, ...EXPORT_BUTTON },
  { t: 6.6, ...EXPORT_BUTTON },
  { t: 7.25, ...NETWORK_TAB },
  { t: 7.5, ...NETWORK_TAB },
  { t: 7.7, ...EXPORT_BUTTON },
  { t: 7.95, ...EXPORT_BUTTON },
  { t: 8.35, ...INPUT_TARGET },
  { t: 9.7, ...INPUT_TARGET },
  { t: 9.85, ...SEND_BUTTON },
  { t: 13.1, ...SEND_BUTTON },
  { t: 13.35, ...CONSOLE_TAB },
  { t: 13.5, ...CONSOLE_TAB },
  { t: 14.7, ...SEND_BUTTON },
  { t: 15.9, ...SEND_BUTTON },
  { t: 16.05, ...NETWORK_TAB },
  { t: 16.2, ...NETWORK_TAB },
  { t: 17.3, ...SEND_BUTTON },
  { t: 24, ...SEND_BUTTON },
  { t: 24.35, ...QUICK_LINK },
  { t: 24.5, ...QUICK_LINK },
  { t: 25, ...PIP_EXPORT },
  { t: 26.2, ...PIP_EXPORT },
  { t: 26.6, ...COPY_BUTTON },
  { t: 26.9, ...COPY_BUTTON },
  { t: 27.3, ...INPUT_TARGET },
  { t: 27.8, ...INPUT_TARGET },
  { t: 28.15, ...SEND_BUTTON },
  { t: 35.2, ...SEND_BUTTON },
  { t: 35.7, ...EXPORT_BUTTON },
  { t: DURATION, ...EXPORT_BUTTON },
];

export const CLICKS = [
  BEATS.saveClick, ...BEATS.deadClicks, BEATS.networkCheck, BEATS.deadClickNetwork, BEATS.send1,
  ...ROUNDS.map((round) => round.send), BEATS.consoleTab, BEATS.networkTab,
  BEATS.quickLink, BEATS.pipExport, BEATS.copy, BEATS.send6, BEATS.exportWorks,
].sort((a, b) => a - b);

export const shakeAt = (t: number) => within(t, VERDICT.shake) ? Math.sin(t * 70) * 5
  : within(t, BEATS.deadShake) ? Math.sin(t * 90) * 4 : 0;
export function cursorAt(t: number) {
  const pointer = pointerAt(CURSOR_KEYS, CLICKS, [], t);
  return { ...pointer, x: pointer.x + shakeAt(t) };
}

export function keysAt(t: number): { keys: string[]; note?: string } | null {
  const capture = captureAt(t);
  if (within(t, [BEATS.devtools - 0.1, BEATS.devtools + 0.3])) return { keys: ["F12"] };
  if (altTabAt(t)) return { keys: ["Alt", "Tab"] };
  if (capture.keys) return { keys: ["⊞ Win", "Shift", "S"] };
  if (pasteKeysAt(t)) return { keys: ["Ctrl", "V"], note: t > BEATS.pip ? "링크 붙여넣기" : `캡처 ${Math.max(1, capture.pasted)}장째` };
  return null;
}

export const CAPTIONS: Caption[] = [
  { text: "설정 저장 완료. 이제 내보내기만 누르면 끝", start: 0.3, end: 3.2 },
  { text: "…? 내보내기가 안 눌린다. 몇 번을 눌러도", start: 3.3, end: 6.6 },
  { text: "콘솔 에러 0, 요청 0까지 직접 확인", start: 6.7, end: 8.3 },
  { text: "재현 조건까지 좁혀서 AI에게 전달", start: 8.4, end: 10.2 },
  { text: "“스크린샷을 보여주시겠어요?”", start: 10.3, end: 12.2 },
  { text: "“Console 탭도 확인 부탁드려요” (이미 말함)", start: 12.3, end: 14.9 },
  { text: "“Network 탭도요” (이미 말함)", start: 15, end: 17.5 },
  { text: "“코드도요”… 캡처 4장째", start: 17.6, end: 20.2 },
  { text: "14분 뒤: “제 환경에서는 정상 작동합니다 🙂”", start: 20.3, end: 23.6 },
  { text: "방금그거뭐였지 2번 → 링크 하나 붙여넣기", start: 23.8, end: 28.2 },
  { text: "지금까지 본 화면 전부에서 원인 발견", start: 30.1, end: 32.9 },
  { text: "사라진 토스트가 버튼을 덮고 있었다", start: 33, end: 35.6 },
  { text: "캡처 4장 대신, 버튼 1번", start: 35.8, end: 40.3 },
];
export const captionAt = (t: number) => captionIn(CAPTIONS, t);

export const SOUND_CUES: { at: number; sound: CueSound }[] = [
  ...CLICKS.map((at) => ({ at, sound: "click" as const })),
  ...APP_SWITCHES.slice(1).map(([at]) => ({ at, sound: "whoosh" as const })),
  { at: BEATS.toast[0], sound: "pop" },
  ...ROUNDS.map((round) => ({ at: round.snip + SHOT_DELAY, sound: "shutter" as const })),
  ...ROUNDS.map((round) => ({ at: round.paste, sound: "pop" as const })),
  { at: BEATS.send1 + 0.1, sound: "pop" },
  { at: VERDICT.card, sound: "boing" },
  { at: BEATS.pip, sound: "pop" },
  { at: BEATS.exported, sound: "pop" },
  { at: BEATS.send6 + 0.1, sound: "pop" },
  { at: BEATS.reply6.card, sound: "ding" },
  { at: BEATS.downloaded, sound: "ding" },
];

export const TYPING: [number, number][] = [[...BEATS.prompt1], ...ROUNDS.map((round) => [...round.noteTyping] as [number, number])];
