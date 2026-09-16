// Script for usage example 02 (VM setup): the VM won't start with a vague
// error, the user screenshots settings tab by tab until they give up (the
// culprit tab flicks past uncaptured), the AI answers off-topic, and a Local
// Folder export of the last 60 seconds lets it spot the real cause at once.

import { INPUT_TARGET, SEND_BUTTON, captionAt as captionIn, pointerAt, typed, within } from "./usage-example-timeline.ts";
import type { Caption, CueSound, CursorKey } from "./usage-example-timeline.ts";

export const DURATION = 36;
export const SPEED = 1.25;
export const VM_NAME = "ubuntu-dev";

// The Box VM window and its parts, in stage units.
export const VM = { x: 40, y: 70, width: 720, height: 600 };
export const TOOLBAR = { y: 132 };
export const SETTINGS_BUTTON = { x: 318, y: 150 };
export const START_BUTTON = { x: 448, y: 150 };
export const ERROR_DIALOG = { x: 180, y: 290, width: 440, height: 190 };
export const ERROR_OK = { x: 555, y: 452 };
export const SETTINGS = { x: 60, y: 110, width: 690, height: 548 };
export const SETTINGS_TABS = ["일반", "시스템", "디스플레이", "저장소", "오디오", "직렬 포트", "USB", "공유 폴더", "네트워크", "사용자 인터페이스"] as const;
export const NETWORK_TAB = SETTINGS_TABS.indexOf("네트워크");
export const TAB_ROW = { x: SETTINGS.x + 12, top: SETTINGS.y + 88, height: 42, width: 250 };
export const tabCenter = (index: number) => ({ x: TAB_ROW.x + 90, y: TAB_ROW.top + index * TAB_ROW.height + TAB_ROW.height / 2 });
// The "다음에 연결됨" dropdown (32 tall) and its first option, NAT, which opens
// right under it in 30-tall rows.
export const ATTACHED_DROPDOWN = { x: SETTINGS.x + 480, y: SETTINGS.y + 230 };
export const NAT_OPTION = { x: SETTINGS.x + 480, y: ATTACHED_DROPDOWN.y + 16 + 15 };
export const SETTINGS_OK = { x: SETTINGS.x + 470, y: SETTINGS.y + 522 };

// The 방금그거뭐였지 PiP and its Local Folder controls.
export const PIP = { x: 70, y: 236, width: 560, height: 424 };
export const FOLDER_MODE = { x: PIP.x + 460, y: PIP.y + 68 };
export const EXPORT_BUTTON = { x: PIP.x + 280, y: PIP.y + 150 };
export const COPY_BUTTON = { x: PIP.x + 280, y: PIP.y + 390 };

export const EXPORT_FOLDER = "whatwas-context-2026-09-16T03-27-44";
export const EXPORT_PROMPT = `로컬 파일시스템에서 저장 경로가 "Documents/${EXPORT_FOLDER}"로 끝나는 폴더를 찾아 주세요. context.md와 events.json을 읽은 뒤 captures/preview 폴더의 화면을 시간순으로 확인해서 제가 무엇을 하고 있었는지 파악해 주세요.`;
export const PROMPT_1 = "VM이 계속 안 켜져;; 설정 화면 다 캡처해서 보냄. 왜 이래?";

// Tabs visited while capturing: the first six are screenshotted and pasted,
// the rest flick past once the user gives up (network among them).
export const CAPTURED_TABS = 6;
const TAB_TIMES = [5.2, 6.2, 7.1, 7.9, 8.65, 9.4, 10.3, 10.65, 11, 11.35];
const CAPTURE_DELAY = { keys: 0.1, shot: 0.28, paste: 0.42 };
// How long the pointer rests on a tab: captured tabs wait for the paste.
const TAB_REST = { captured: [0.2, 0.48], flicked: [0.12, 0.15] };

export const BEATS = {
  start1: 0.9,
  error1: [1.1, 2.3],
  ok1: 2.2,
  start2: 2.7,
  error2: [2.9, 4.1],
  ok2: 4.0,
  settingsOpen: 4.7,
  tabs: TAB_TIMES,
  settingsClose: 11.9,
  prompt1: [12.4, 13.6],
  send1: 13.9,
  reply1: { thinking: 14.2, card: 15, text: [15.1, 17], done: 17.3, cardEnd: 18.4 },
  pip: 18.7,
  folderMode: 19.5,
  exportClick: 20.3,
  exporting: [20.4, 21.2],
  exported: 21.3,
  copy: 22.1,
  pasteKeys: 22.9,
  pasted: 23.05,
  pipMinimize: 23.3,
  send2: 23.7,
  reply2: { thinking: 24, tools: [24.3, 24.7, 25.1], card: 25.6, text: [25.8, 27.6], done: 27.9, cardEnd: 30.4 },
  fixOpen: 28.6,
  dropdown: 29.2,
  nat: 29.7,
  fixOk: 30.3,
  start3: 30.9,
  booting: [31.2, 32.6],
  booted: 32.6,
  end: DURATION,
} as const;

export type Screen = "manager" | "settings";
export type VmState = {
  screen: Screen; tab: number; error: boolean; status: "off" | "booting" | "running";
  adapter: "bridged" | "nat"; dropdownOpen: boolean;
  capture: { keys: boolean; flash: number; count: number };
};

const captureTimes = TAB_TIMES.slice(0, CAPTURED_TABS);

export function vmAt(t: number): VmState {
  const inSettings = within(t, [BEATS.settingsOpen, BEATS.settingsClose]) || within(t, [BEATS.fixOpen, BEATS.fixOk + 0.1]);
  const fixing = t >= BEATS.fixOpen;
  let tab = 0;
  if (fixing) tab = NETWORK_TAB;
  else TAB_TIMES.forEach((at, index) => { if (t >= at) tab = index; });
  const keys = captureTimes.some((at) => within(t, [at + CAPTURE_DELAY.keys, at + CAPTURE_DELAY.shot]));
  const flash = Math.max(0, ...captureTimes.map((at) => 1 - Math.abs(t - (at + CAPTURE_DELAY.shot)) / 0.12));
  const count = t >= BEATS.send1 ? 0 : captureTimes.filter((at) => t >= at + CAPTURE_DELAY.paste).length;
  return {
    screen: inSettings ? "settings" : "manager",
    tab,
    error: within(t, BEATS.error1) || within(t, BEATS.error2),
    status: t >= BEATS.booted ? "running" : t >= BEATS.booting[0] ? "booting" : "off",
    adapter: t >= BEATS.nat ? "nat" : "bridged",
    dropdownOpen: within(t, [BEATS.dropdown + 0.05, BEATS.nat]),
    capture: { keys, flash, count },
  };
}

export const pasteKeysAt = (t: number) => captureTimes.some((at) => within(t, [at + CAPTURE_DELAY.paste - 0.05, at + CAPTURE_DELAY.paste + 0.3]))
  || within(t, [BEATS.pasteKeys, BEATS.pasteKeys + 0.4]);

export type PipState = { visible: boolean; minimized: boolean; folder: boolean; exporting: boolean; exported: boolean; copied: boolean };
export function pipAt(t: number): PipState {
  return {
    visible: t >= BEATS.pip,
    minimized: t >= BEATS.pipMinimize,
    folder: t >= BEATS.folderMode + 0.1,
    exporting: within(t, BEATS.exporting),
    exported: t >= BEATS.exported,
    copied: t >= BEATS.copy + 0.05,
  };
}

export function chatInputAt(t: number) {
  const vm = vmAt(t);
  if (t < BEATS.send1) return { text: typed(PROMPT_1, BEATS.prompt1, t), attachments: vm.capture.count, typing: within(t, [BEATS.prompt1[0], BEATS.send1]) };
  if (t >= BEATS.pasted && t < BEATS.send2) return { text: EXPORT_PROMPT, attachments: 0, typing: false };
  return { text: "", attachments: 0, typing: false };
}

export const REPLY_1 = "캡처 잘 봤어요! 음… BIOS에서 가상화(VT-x)를 켜 보셨나요? 그래도 안 되면 메모리를 64GB로 늘리거나 운영체제를 다시 설치해 보세요 🙂";
export const DONE_1 = "※ 첨부하신 6장에서는 특별한 문제가 보이지 않습니다.";
export const TOOLS_2 = ["📄 context.md 읽음 · 최근 60초", "📋 events.json · 화면 변화 21건", "🖼 captures/preview 60장 시간순 확인"];
export const REPLY_2 = "찾았어요! 설정을 넘기실 때 03:27:43에 잠깐 지나간 '네트워크 › 어댑터 1'이 '브리지 어댑터'인데, 연결할 인터페이스가 '선택 안 됨'이에요. 그래서 시작하자마자 E_FAIL이 납니다.";
export const DONE_2 = "'다음에 연결됨'을 NAT로 바꾸면 바로 켜집니다.";

export type VmChat =
  | { id: string; role: "user"; text: string; images: number }
  | { id: string; role: "claudy"; text: string; thinking: boolean; tools: string[]; done: string; evidence: boolean };

export function chatAt(t: number): VmChat[] {
  const messages: VmChat[] = [];
  if (t >= BEATS.send1) messages.push({ id: "u1", role: "user", text: PROMPT_1, images: CAPTURED_TABS });
  const r1 = BEATS.reply1;
  if (t >= r1.thinking) messages.push({
    id: "c1", role: "claudy", thinking: t < r1.text[0], text: typed(REPLY_1, r1.text, t), tools: [], done: t >= r1.done ? DONE_1 : "", evidence: false,
  });
  if (t >= BEATS.send2) messages.push({ id: "u2", role: "user", text: EXPORT_PROMPT, images: 0 });
  const r2 = BEATS.reply2;
  if (t >= r2.thinking) messages.push({
    id: "c2", role: "claudy", thinking: t < r2.text[0], text: typed(REPLY_2, r2.text, t),
    tools: TOOLS_2.filter((_, index) => t >= r2.tools[index]), done: t >= r2.done ? DONE_2 : "", evidence: t >= r2.text[1],
  });
  return messages;
}

export const cardAt = (t: number): "dumb" | "smart" | null =>
  within(t, [BEATS.reply1.card, BEATS.reply1.cardEnd]) ? "dumb" : within(t, [BEATS.reply2.card, BEATS.reply2.cardEnd]) ? "smart" : null;

const settingsTargets: CursorKey[] = TAB_TIMES.flatMap((at, index) => [
  { t: at - (index < CAPTURED_TABS ? TAB_REST.captured : TAB_REST.flicked)[0], ...tabCenter(index) },
  { t: at + (index < CAPTURED_TABS ? TAB_REST.captured : TAB_REST.flicked)[1], ...tabCenter(index) },
]);

const CURSOR_KEYS: CursorKey[] = [
  { t: 0, x: 640, y: 560 },
  { t: 0.85, ...START_BUTTON },
  { t: 1.8, ...START_BUTTON },
  { t: 2.15, ...ERROR_OK },
  { t: 2.3, ...ERROR_OK },
  { t: 2.65, ...START_BUTTON },
  { t: 3.6, ...START_BUTTON },
  { t: 3.95, ...ERROR_OK },
  { t: 4.15, ...ERROR_OK },
  { t: 4.65, ...SETTINGS_BUTTON },
  ...settingsTargets,
  { t: 11.85, ...tabCenter(SETTINGS_TABS.length - 1) },
  { t: 12.35, ...INPUT_TARGET },
  { t: 13.55, ...INPUT_TARGET },
  { t: 13.85, ...SEND_BUTTON },
  { t: 19, ...SEND_BUTTON },
  { t: 19.45, ...FOLDER_MODE },
  { t: 19.8, ...FOLDER_MODE },
  { t: 20.25, ...EXPORT_BUTTON },
  { t: 21.5, ...EXPORT_BUTTON },
  { t: 22.05, ...COPY_BUTTON },
  { t: 22.4, ...COPY_BUTTON },
  { t: 22.85, ...INPUT_TARGET },
  { t: 23.3, ...INPUT_TARGET },
  { t: 23.65, ...SEND_BUTTON },
  { t: 28.3, ...SEND_BUTTON },
  { t: 29.15, ...ATTACHED_DROPDOWN },
  { t: 29.35, ...ATTACHED_DROPDOWN },
  { t: 29.65, ...NAT_OPTION },
  { t: 29.85, ...NAT_OPTION },
  { t: 30.25, ...SETTINGS_OK },
  { t: 30.4, ...SETTINGS_OK },
  { t: 30.85, ...START_BUTTON },
  { t: DURATION, ...START_BUTTON },
];

export const CLICKS = [
  BEATS.start1, BEATS.ok1, BEATS.start2, BEATS.ok2, BEATS.settingsOpen, ...TAB_TIMES, BEATS.send1,
  BEATS.folderMode, BEATS.exportClick, BEATS.copy, BEATS.send2, BEATS.dropdown, BEATS.nat, BEATS.fixOk, BEATS.start3,
].sort((a, b) => a - b);

export const CURSOR_TIMES = CURSOR_KEYS.map((key) => key.t);
export const cursorAt = (t: number) => pointerAt(CURSOR_KEYS, CLICKS, [], t);

export const CAPTIONS: Caption[] = [
  { text: "VM이 자꾸 안 켜진다… 이유는 모름", start: 0.6, end: 4.6 },
  { text: "원인을 모르니 설정을 하나하나 캡처해서 붙여넣기…", start: 4.8, end: 9.4 },
  { text: "…설정 창이 너무 많다. 지쳐서 나머지는 대충 넘김", start: 9.5, end: 12.2 },
  { text: "…AI는 엉뚱한 소리만", start: 15.1, end: 18.5 },
  { text: "방금그거뭐였지 Local Folder로 최근 60초를 통째로 전달", start: 18.8, end: 23.6 },
  { text: "넘겨본 화면까지 전부 보더니, 갑자기 똑똑해진 AI", start: 25.6, end: 29.8 },
  { text: "원인을 바로 짚어서 한 번에 해결", start: 30.9, end: 35.5 },
];
export const captionAt = (t: number) => captionIn(CAPTIONS, t);

export const SOUND_CUES: { at: number; sound: CueSound }[] = [
  ...CLICKS.map((at) => ({ at, sound: "click" as const })),
  { at: BEATS.error1[0], sound: "boing" },
  { at: BEATS.error2[0], sound: "boing" },
  ...captureTimes.map((at) => ({ at: at + CAPTURE_DELAY.shot, sound: "shutter" as const })),
  ...captureTimes.map((at) => ({ at: at + CAPTURE_DELAY.paste, sound: "pop" as const })),
  { at: BEATS.send1 + 0.1, sound: "pop" },
  { at: BEATS.reply1.card, sound: "pop" },
  { at: BEATS.pip, sound: "pop" },
  { at: BEATS.exported, sound: "pop" },
  { at: BEATS.send2 + 0.1, sound: "pop" },
  { at: BEATS.reply2.card, sound: "ding" },
  { at: BEATS.booted, sound: "ding" },
];

export const TYPING: [number, number][] = [[...BEATS.prompt1]];
