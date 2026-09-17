// Script for the "CORS 아닌 CORS 에러" usage example: a fetch fails because
// `process.env.API_URL` is undefined in the browser (it lacks the
// NEXT_PUBLIC_ prefix). The developer reports the 404, the HTML response and
// that CORS is already open, yet the AI keeps "fixing" CORS. An Agent Link of
// the last 30 seconds shows the request headers the developer clicked past,
// where the URL reads `/undefined/api/users`. Everything is a pure function of
// the playhead `t`.

import { INPUT_TARGET, SEND_BUTTON, captionAt as captionIn, pointerAt, typed, within } from "./usage-example-timeline.ts";
import type { Caption, CueSound, CursorKey } from "./usage-example-timeline.ts";

export const DURATION = 37;
export const SPEED = 1.25;

// The work area on the left: a code editor or a browser with DevTools,
// switched with Alt+Tab. Coordinates are stage units.
export const WORK = { x: 40, y: 70, width: 720, height: 600 };
export const DEVTOOLS_TOP = 360;
export const CONSOLE_TAB = { x: WORK.x + 128, y: DEVTOOLS_TOP + 16 };
export const NETWORK_TAB = { x: WORK.x + 208, y: DEVTOOLS_TOP + 16 };
export const USERS_ROW = { x: WORK.x + 70, y: DEVTOOLS_TOP + 82 };
export const HEADERS_PANEL = { x: WORK.x + 250, y: DEVTOOLS_TOP + 32 };
export const HEADERS_CLOSE = { x: HEADERS_PANEL.x + 14, y: HEADERS_PANEL.y + 14 };
export const ERROR_LINE = { x: WORK.x + 300, y: DEVTOOLS_TOP + 52 };

// The 방금그거뭐였지 PiP: the minimized bar's quick "2" opens Agent Link.
export const PIP = { x: 70, y: 236, width: 560, height: 424 };
export const PIP_BAR_Y = PIP.y + PIP.height - 78;
export const QUICK_MODES_LEFT = 190;
export const QUICK_LINK = { x: PIP.x + QUICK_MODES_LEFT + 36, y: PIP_BAR_Y + 30 + 24 };
export const EXPORT_BUTTON = { x: PIP.x + 280, y: PIP.y + 150 };
export const COPY_BUTTON = { x: PIP.x + 280, y: PIP.y + 390 };

export const API_URL_LINE = "fetch(`${process.env.API_URL}/api/users`)";
export const REQUEST_URL = "http://localhost:3000/undefined/api/users";
export const ERROR_TEXT = "SyntaxError: Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON";
export const PROMPT_1_TYPED = "/api/users가 404고 응답이 JSON 아니라 HTML임. 백엔드(8080) CORS는 이미 열어둠. 콘솔:";
export const PROMPT_1 = `${PROMPT_1_TYPED} ${ERROR_TEXT}`;
export const PROMPT_2_TYPED = "CORS 아니라니까. 여전히 404에 HTML 응답:";
export const PROMPT_2 = `${PROMPT_2_TYPED} ${ERROR_TEXT}`;
export const LINK_URL = "https://whatwas.vercel.app/context/k3Vn8qQ2xR7mWbT0pLc4_zY1uHs9eJdA6fNiG5oKvXw/agent";
export const LINK_PROMPT = `최근 30초 화면 기록을 확인해서 제가 무엇을 하고 있었는지 파악해 주세요. ${LINK_URL}`;

export const BEATS = {
  editorType: [0.4, 1.9],
  save: 2.2,
  reloads: [3.3, 13.4, 18.0, 31.5],
  networkTab: 4.6,
  usersRow: 5.2,
  headersOpen: [5.25, 6.05],
  consoleTab: 6.45,
  selectError: 6.75,
  copyKeys: [6.9, 7.2],
  prompt1: [7.3, 8.2],
  paste1: 8.45,
  send1: 9.0,
  reply1: { thinking: 9.3, text: [9.9, 11.2], done: 11.4 },
  restarts: [[12.3, 12.9], [17.0, 17.5], [30.4, 30.9]],
  prompt2: [13.85, 14.25],
  paste2: 14.35,
  send2: 14.6,
  reply2: { thinking: 14.85, card: 15.3, text: [15.3, 16.4], done: 16.6, cardEnd: 17.4 },
  shake: [18.4, 19.1],
  pip: 19.3,
  quickLink: 19.9,
  exportClick: 20.6,
  exporting: [20.7, 21.5],
  exported: 21.6,
  copy: 22.2,
  pasteKeys: 22.9,
  pasted: 23.05,
  pipMinimize: 23.3,
  send3: 23.7,
  reply3: { thinking: 24, tools: [24.3, 24.7, 25.1], card: 25.6, text: [25.8, 27.9], done: 28.1, cardEnd: 30.3 },
  diff: [28.7, 30.1],
  loaded: 31.8,
  end: DURATION,
} as const;

// Which app is in front, and when Alt+Tab switches it.
const APP_SWITCHES: [number, App][] = [[0, "editor"], [3.0, "browser"], [11.9, "editor"], [13.1, "browser"], [16.8, "editor"], [17.7, "browser"], [28.5, "editor"], [31.1, "browser"]];
export type App = "editor" | "browser";
// The player can hand in a slightly negative t on its first frame.
export const appAt = (t: number): App => (APP_SWITCHES.findLast(([at]) => t >= at) ?? APP_SWITCHES[0])[1];
export const altTabAt = (t: number) => APP_SWITCHES.slice(1).some(([at]) => within(t, [at - 0.15, at + 0.25]));

// --- Editor -----------------------------------------------------------------

export const CODE: Record<string, string[]> = {
  "users.tsx": [
    "export default function Users() {",
    "  const [users, setUsers] = useState<User[]>([]);",
    "  useEffect(() => {",
    `    ${API_URL_LINE}`,
    "      .then((res) => res.json())",
    "      .then(setUsers);",
    "  }, []);",
    "  return <UserList users={users} />;",
    "}",
  ],
  "server.ts": [
    "import express from \"express\";",
    "import cors from \"cors\";",
    "",
    "const app = express();",
    "app.use(cors({ origin: \"http://localhost:3000\", credentials: true }));",
    "app.use(cors({ origin: \"*\" }));     // AI 추가",
    "app.get(\"/api/users\", listUsers);",
    "app.listen(8080);",
  ],
  "next.config.js": [
    "module.exports = {",
    "  async headers() {                  // AI 추가",
    "    return [{ source: \"/:path*\", headers: [",
    "      { key: \"Access-Control-Allow-Origin\", value: \"*\" },",
    "      { key: \"Access-Control-Allow-Credentials\", value: \"true\" },",
    "    ] }];",
    "  },",
    "};",
  ],
};

export type DiffRow = { file: string; kind: "add" | "del"; text: string };
export const DIFF_ROWS: DiffRow[] = [
  { file: ".env", kind: "del", text: "API_URL=http://localhost:8080" },
  { file: ".env", kind: "add", text: "NEXT_PUBLIC_API_URL=http://localhost:8080" },
  { file: "users.tsx", kind: "del", text: API_URL_LINE },
  { file: "users.tsx", kind: "add", text: "fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/users`)" },
  { file: "server.ts", kind: "del", text: "app.use(cors({ origin: \"*\" }));" },
  { file: "cors.ts", kind: "del", text: "파일 삭제 · 24줄" },
  { file: "next.config.js", kind: "del", text: "async headers() { … Access-Control-Allow-* … }" },
];

const TERMINAL_BASE = ["$ npm run dev", "▲ Next.js 16.3 · http://localhost:3000", "✓ Ready in 812ms"];
const RESTART_LINES = [
  ["^C", "$ npm run dev", "✓ Ready in 790ms · 재시작 3번째"],
  ["^C", "$ npm run dev", "✓ Ready in 804ms · 재시작 4번째"],
  ["^C", "$ npm run dev", "✓ Ready in 771ms", "✓ Compiled /users in 298ms"],
];

export type EditorState = {
  tabs: string[]; active: string; typedLine: string; diffRows: number; terminal: string[]; saved: boolean;
};

export function editorAt(t: number): EditorState {
  const r = BEATS;
  let tabs = ["users.tsx"];
  if (t >= r.reply1.done) tabs = [...tabs, "server.ts"];
  if (t >= r.reply2.done) tabs = [...tabs, "cors.ts", "next.config.js"];
  if (t >= r.diff[1]) tabs = ["users.tsx", ".env"];
  const active = t >= r.diff[0] ? "변경 사항" : t >= 16.8 ? "next.config.js" : t >= 11.9 ? "server.ts" : "users.tsx";
  if (t >= r.diff[0] && !tabs.includes("변경 사항")) tabs = [...tabs, "변경 사항"];
  const terminal = [...TERMINAL_BASE];
  if (t >= r.save + 0.05) terminal.push("○ Compiling /users ...", "✓ Compiled in 312ms");
  r.restarts.forEach(([start, end], index) => {
    if (t < start) return;
    const lines = RESTART_LINES[index];
    terminal.push(...lines.slice(0, Math.max(1, Math.ceil(lines.length * Math.min(1, (t - start) / (end - start))))));
  });
  const diffProgress = Math.min(1, Math.max(0, (t - r.diff[0]) / (r.diff[1] - r.diff[0])));
  return {
    tabs, active,
    typedLine: `    ${typed(API_URL_LINE, r.editorType, t)}`,
    diffRows: t < r.diff[0] ? 0 : Math.ceil(diffProgress * DIFF_ROWS.length),
    terminal: terminal.slice(-6),
    saved: t >= r.save,
  };
}

export const restartingAt = (t: number) => BEATS.restarts.some((span) => within(t, span));

// --- Browser ----------------------------------------------------------------

export type PageStatus = "idle" | "loading" | "error" | "loaded";
export type BrowserState = {
  page: PageStatus; devtoolsTab: "console" | "network"; headersOpen: boolean;
  consoleError: boolean; errorSelected: boolean; requestStatus: 404 | 200 | null;
};

export function browserAt(t: number): BrowserState {
  const r = BEATS;
  const lastReload = r.reloads.filter((at) => t >= at).at(-1);
  const fixed = lastReload === r.reloads[r.reloads.length - 1];
  let page: PageStatus = "idle";
  if (lastReload !== undefined) page = t < lastReload + 0.3 ? "loading" : fixed ? "loaded" : "error";
  return {
    page,
    devtoolsTab: within(t, [r.networkTab, r.consoleTab]) ? "network" : "console",
    headersOpen: within(t, r.headersOpen),
    consoleError: page === "error",
    errorSelected: within(t, [r.selectError, r.send1]),
    requestStatus: lastReload === undefined ? null : fixed ? 200 : 404,
  };
}

export const errorFlashes = BEATS.reloads.slice(0, -1).map((at) => at + 0.3);
export const shakeAt = (t: number) => within(t, BEATS.shake) ? Math.sin(t * 70) * 5 : 0;

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

export function chatInputAt(t: number) {
  const r = BEATS;
  if (t < r.send1) {
    const text = typed(PROMPT_1_TYPED, r.prompt1, t) + (t >= r.paste1 ? ` ${ERROR_TEXT}` : "");
    return { text, typing: within(t, [r.prompt1[0], r.send1]) };
  }
  if (within(t, [r.prompt2[0], r.send2])) {
    return { text: typed(PROMPT_2_TYPED, r.prompt2, t) + (t >= r.paste2 ? ` ${ERROR_TEXT}` : ""), typing: true };
  }
  if (within(t, [r.pasted, r.send3])) return { text: LINK_PROMPT, typing: false };
  return { text: "", typing: false };
}

export const pasteKeysAt = (t: number) => within(t, [BEATS.paste1 - 0.1, BEATS.paste1 + 0.25])
  || within(t, [BEATS.paste2 - 0.08, BEATS.paste2 + 0.2]) || within(t, [BEATS.pasteKeys, BEATS.pasteKeys + 0.4]);

export const REPLY_1 = "백엔드가 8080이라 출처가 달라서 생기는 CORS 문제예요. server.ts에 cors() 미들웨어를 추가했습니다 ✅";
export const DONE_1 = "서버를 재시작하면 해결됩니다.";
export const REPLY_2 = "그렇다면 Preflight가 막힌 거예요. Access-Control-Allow-Origin과 Credentials 헤더를 cors.ts와 next.config.js에 추가했어요 ✅";
export const DONE_2 = "서버를 한 번 더 재시작해 주세요.";
export const TOOLS_3 = ["🔗 Agent Link 열기 · 최근 30초", "📋 events.json · 화면 변화 14건", "🖼 captures 12장 · Network 탭 확대"];
export const REPLY_3 = `찾았어요. Network › Headers를 잠깐 여셨을 때 Request URL이 ${REQUEST_URL} 이었어요. 요청이 8080이 아니라 Next 서버로 가서 404 HTML을 받은 거라, 말씀대로 CORS 문제가 아닙니다.`;
export const DONE_3 = "브라우저에서는 NEXT_PUBLIC_ 접두사가 붙은 변수만 읽혀서 API_URL이 undefined였어요. .env를 고치고, 제가 넣었던 CORS 코드는 전부 되돌릴게요.";

export type CorsChat =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "claudy"; text: string; thinking: boolean; tools: string[]; done: string; evidence: boolean };

export function chatAt(t: number): CorsChat[] {
  const r = BEATS;
  const messages: CorsChat[] = [];
  if (t >= r.send1) messages.push({ id: "u1", role: "user", text: PROMPT_1 });
  if (t >= r.reply1.thinking) messages.push({
    id: "c1", role: "claudy", thinking: t < r.reply1.text[0], text: typed(REPLY_1, r.reply1.text, t), tools: [], done: t >= r.reply1.done ? DONE_1 : "", evidence: false,
  });
  if (t >= r.send2) messages.push({ id: "u2", role: "user", text: PROMPT_2 });
  if (t >= r.reply2.thinking) messages.push({
    id: "c2", role: "claudy", thinking: t < r.reply2.text[0], text: typed(REPLY_2, r.reply2.text, t), tools: [], done: t >= r.reply2.done ? DONE_2 : "", evidence: false,
  });
  if (t >= r.send3) messages.push({ id: "u3", role: "user", text: LINK_PROMPT });
  const r3 = r.reply3;
  if (t >= r3.thinking) messages.push({
    id: "c3", role: "claudy", thinking: t < r3.text[0], text: typed(REPLY_3, r3.text, t),
    tools: TOOLS_3.filter((_, index) => t >= r3.tools[index]), done: t >= r3.done ? DONE_3 : "", evidence: t >= r3.text[1],
  });
  return messages;
}

export const cardAt = (t: number): "dumb" | "smart" | null =>
  within(t, [BEATS.reply2.card, BEATS.reply2.cardEnd]) ? "dumb" : within(t, [BEATS.reply3.card, BEATS.reply3.cardEnd]) ? "smart" : null;

// --- Pointer, captions, sound -----------------------------------------------

const REST = { x: WORK.x + 520, y: WORK.y + 200 };
const CURSOR_KEYS: CursorKey[] = [
  { t: 0, x: 640, y: 560 },
  { t: 3.0, ...REST },
  { t: 4.2, ...REST },
  { t: 4.5, ...NETWORK_TAB },
  { t: 4.7, ...NETWORK_TAB },
  { t: 5.05, ...USERS_ROW },
  { t: 5.35, ...USERS_ROW },
  { t: 5.85, ...HEADERS_CLOSE },
  { t: 6.15, ...HEADERS_CLOSE },
  { t: 6.38, ...CONSOLE_TAB },
  { t: 6.52, ...CONSOLE_TAB },
  { t: 6.7, ...ERROR_LINE },
  { t: 7.0, ...ERROR_LINE },
  { t: 7.28, ...INPUT_TARGET },
  { t: 8.8, ...INPUT_TARGET },
  { t: 8.95, ...SEND_BUTTON },
  { t: 13.5, ...SEND_BUTTON },
  { t: 13.8, ...INPUT_TARGET },
  { t: 14.4, ...INPUT_TARGET },
  { t: 14.55, ...SEND_BUTTON },
  { t: 18.2, ...SEND_BUTTON },
  { t: 18.4, ...REST },
  { t: 19.4, ...REST },
  { t: 19.8, ...QUICK_LINK },
  { t: 20.1, ...QUICK_LINK },
  { t: 20.5, ...EXPORT_BUTTON },
  { t: 21.7, ...EXPORT_BUTTON },
  { t: 22.1, ...COPY_BUTTON },
  { t: 22.45, ...COPY_BUTTON },
  { t: 22.85, ...INPUT_TARGET },
  { t: 23.4, ...INPUT_TARGET },
  { t: 23.65, ...SEND_BUTTON },
  { t: 28.4, ...SEND_BUTTON },
  { t: 29.2, ...REST },
  { t: DURATION, ...REST },
];

export const CLICKS = [
  BEATS.networkTab, BEATS.usersRow, BEATS.headersOpen[1], BEATS.consoleTab, BEATS.selectError,
  BEATS.send1, BEATS.send2, BEATS.quickLink, BEATS.exportClick, BEATS.copy, BEATS.send3,
].sort((a, b) => a - b);

export const CURSOR_TIMES = CURSOR_KEYS.map((key) => key.t);
export function cursorAt(t: number) {
  const pointer = pointerAt(CURSOR_KEYS, CLICKS, [], t);
  return { ...pointer, x: pointer.x + shakeAt(t) };
}

export const CAPTIONS: Caption[] = [
  { text: "평범한 하루: 프론트에 백엔드 API 붙이는 중", start: 0.4, end: 3.0 },
  { text: "API 호출 실패 → Network에서 404 확인", start: 3.6, end: 6.6 },
  { text: "404 · HTML 응답 · CORS 설정 여부까지 정리해서 전달", start: 6.7, end: 9.2 },
  { text: "“CORS 문제입니다” (이미 열려 있다고 했는데)", start: 9.9, end: 12.2 },
  { text: "서버 재시작… 똑같음", start: 12.3, end: 14.6 },
  { text: "“그렇다면 Preflight입니다” (또 CORS)", start: 15.2, end: 16.9 },
  { text: "서버 재시작 4번째… AI가 넣은 설정 파일만 늘어난다", start: 17.0, end: 19.2 },
  { text: "방금그거뭐였지 2번(Agent Link) → 링크 하나 붙여넣기", start: 19.3, end: 23.8 },
  { text: "스쳐 지나간 Request URL에서 진짜 원인 발견", start: 25.6, end: 28.5 },
  { text: "CORS 아님. AI가 넣은 코드는 전부 되돌리기", start: 28.6, end: 31.2 },
  { text: "에러 한 줄 말고, 방금 본 화면 전부", start: 31.8, end: 36.5 },
];
export const captionAt = (t: number) => captionIn(CAPTIONS, t);

export function keysAt(t: number): { keys: string[]; note?: string } | null {
  const r = BEATS;
  if (within(t, [r.save - 0.1, r.save + 0.3])) return { keys: ["Ctrl", "S"] };
  if (altTabAt(t)) return { keys: ["Alt", "Tab"] };
  if (within(t, r.copyKeys)) return { keys: ["Ctrl", "C"], note: "콘솔 에러 복사" };
  if (restartingAt(t)) return { keys: ["Ctrl", "C"], note: "서버 재시작" };
  if (r.reloads.some((at) => within(t, [at - 0.1, at + 0.25]))) return { keys: ["F5"] };
  if (pasteKeysAt(t)) return { keys: ["Ctrl", "V"], note: t > r.pip ? "링크 붙여넣기" : "에러 붙여넣기" };
  return null;
}

export const SOUND_CUES: { at: number; sound: CueSound }[] = [
  ...CLICKS.map((at) => ({ at, sound: "click" as const })),
  ...APP_SWITCHES.slice(1).map(([at]) => ({ at, sound: "whoosh" as const })),
  ...errorFlashes.map((at) => ({ at, sound: "boing" as const })),
  { at: BEATS.send1 + 0.1, sound: "pop" },
  { at: BEATS.send2 + 0.1, sound: "pop" },
  { at: BEATS.reply2.card, sound: "pop" },
  { at: BEATS.pip, sound: "pop" },
  { at: BEATS.exported, sound: "pop" },
  { at: BEATS.send3 + 0.1, sound: "pop" },
  { at: BEATS.reply3.card, sound: "ding" },
  { at: BEATS.loaded, sound: "ding" },
];

export const TYPING: [number, number][] = [[...BEATS.editorType], [...BEATS.prompt1], [...BEATS.prompt2]];
