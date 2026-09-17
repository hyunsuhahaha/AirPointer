// Script for the "팀원은 못 보는 번쩍임" usage example. A designer doing QA
// on staging sees a white flash on every page change in dark mode. Every
// screenshot comes too late and the developer can't see it. The designer
// drops one Agent Link of the last 30 seconds into the team channel, and the
// whole team (frontend, PM, QA) opens the very same screen; the developer
// also hands the link to his AI, which finds the light-theme first paint.
// Everything is a pure function of the playhead `t`.

import { INPUT_TARGET, SEND_BUTTON, captionAt as captionIn, pointerAt, typed, within } from "./usage-example-timeline.ts";
import type { Caption, CueSound, CursorKey } from "./usage-example-timeline.ts";

export const DURATION = 37;
export const SPEED = 1.25;

// Layout, in stage units. The staging app has a sidebar on the left.
export const WORK = { x: 40, y: 70, width: 720, height: 600 };
export const NAV = ["대시보드", "리포트", "설정"] as const;
export type Page = (typeof NAV)[number];
export const navCenter = (page: Page) => ({ x: WORK.x + 80, y: WORK.y + 139 + NAV.indexOf(page) * 44 });
const REST = { x: WORK.x + 460, y: WORK.y + 300 };

export const PIP = { x: 70, y: 236, width: 560, height: 424 };
export const QUICK_LINK = { x: PIP.x + 190 + 36, y: PIP.y + PIP.height - 78 + 30 + 24 };
export const PIP_EXPORT = { x: PIP.x + 280, y: PIP.y + 150 };
export const COPY_BUTTON = { x: PIP.x + 280, y: PIP.y + 390 };

export const LINK_URL = "https://whatwas.vercel.app/context/Qm7tX2vLpR9aKc4Hn0Ew_dZ6yUbF3sJgT8oVi1MhNkw/agent";
export const LINK_PROMPT = `최근 30초 화면 기록을 확인해서 제가 무엇을 하고 있었는지 파악해 주세요. ${LINK_URL}`;
export const PROMPT_1 = "다크모드에서 페이지 넘길 때마다 흰 화면이 한 번 번쩍여요. 0.2초쯤이라 캡처엔 안 찍혀요 😢";
export const PROMPT_2 = "강력 새로고침해도 똑같아요";
export const SHARE_TEXT = `방금 본 30초 그대로예요. 다들 한번 봐주세요 👉 ${LINK_URL}`;

export const BEATS = {
  navs: [[1.6, "리포트"], [3.4, "설정"], [5.2, "리포트"], [31.8, "대시보드"], [32.6, "리포트"]] as [number, Page][],
  // White first paints before the fix; the reload flashes too.
  flashes: [1.65, 3.45, 5.25, 12.6],
  reload: 12.5,
  snips: [4.2, 5.8],
  pasteImage: 7.0,
  prompt1: [7.2, 8.4],
  send1: 8.8,
  prompt2: [13.2, 13.6],
  send2: 13.8,
  pip: 18.0,
  quickLink: 18.6,
  pipExport: 19.3,
  exporting: [19.4, 20.2] as [number, number],
  exported: 20.3,
  copy: 20.9,
  pasteKeys: 21.6,
  pasted: 21.75,
  pipMinimize: 22.0,
  send3: 22.4,
  shared: [22.7, 25.6] as [number, number],
  analysis: { thinking: 25.6, tools: [25.8, 26.1, 26.4], card: 26.5, text: [26.6, 28.4], done: 28.6, cardEnd: 29.4 },
  deployed: 30.0,
  clean: 33.0,
  end: DURATION,
} as const;
export const FLASH_SECONDS = 0.25;
export const SHOT_DELAY = 0.2;

// --- Browser ----------------------------------------------------------------

export type BrowserState = { page: Page; flash: number; reloading: boolean; fixed: boolean };
export function browserAt(t: number): BrowserState {
  const page = BEATS.navs.filter(([at]) => t >= at).at(-1)?.[1] ?? "대시보드";
  const flashAt = BEATS.flashes.find((at) => within(t, [at, at + FLASH_SECONDS]));
  return {
    page,
    flash: flashAt === undefined ? 0 : 1 - (t - flashAt) / FLASH_SECONDS / 2,
    reloading: within(t, [BEATS.reload, BEATS.reload + 0.35]),
    fixed: t >= BEATS.deployed,
  };
}

export type CaptureState = { keys: boolean; flash: number; missed: boolean };
export function captureAt(t: number): CaptureState {
  return {
    keys: BEATS.snips.some((at) => within(t, [at, at + SHOT_DELAY])),
    flash: Math.max(0, ...BEATS.snips.map((at) => 1 - Math.abs(t - (at + SHOT_DELAY)) / 0.12)),
    // The "captured" preview: always the plain dark page.
    missed: BEATS.snips.some((at) => within(t, [at + SHOT_DELAY, at + SHOT_DELAY + 1.1])),
  };
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

// --- Team chat --------------------------------------------------------------

export type Author = "me" | "minjun" | "seoyeon" | "jiho";
export const TEAM: Record<Author, { name: string; role: string; color: string }> = {
  me: { name: "나", role: "디자이너", color: "#ff6b22" },
  minjun: { name: "민준", role: "프론트엔드", color: "#3b82f6" },
  seoyeon: { name: "서연", role: "PM", color: "#a855f7" },
  jiho: { name: "지호", role: "QA", color: "#10b981" },
};

// Everyone who opens the shared link, in order: the point of the example.
export const VIEWERS: { author: Exclude<Author, "me">; at: number }[] = [
  { author: "minjun", at: 23.0 },
  { author: "seoyeon", at: 23.5 },
  { author: "jiho", at: 24.0 },
];
export const viewersAt = (t: number) => VIEWERS.filter((viewer) => t >= viewer.at);
export const sharedCardAt = (t: number) => within(t, BEATS.shared);
export type TeamMessage =
  | { id: string; kind: "text"; author: Author; text: string; image: boolean; views?: number }
  | { id: string; kind: "analysis"; thinking: boolean; tools: string[]; text: string; done: string; evidence: boolean };

// Teammates' replies, each preceded by a typing indicator.
export const REPLIES: { id: string; author: Exclude<Author, "me">; typing: number; at: number; text: string }[] = [
  { id: "d1", author: "minjun", typing: 9.2, at: 10.0, text: "스크린샷엔 그냥 다크인데요? 제 쪽에선 안 보여요 👀" },
  { id: "d2", author: "minjun", typing: 10.7, at: 11.4, text: "혹시 강력 새로고침(Ctrl+Shift+R) 해보실래요?" },
  { id: "d3", author: "minjun", typing: 14.4, at: 15.2, text: "AI한테도 물어봤는데 '코드상 다크모드 처리는 정상'이래요 🤔 영상 있으면 좋겠는데…" },
  { id: "s1", author: "seoyeon", typing: 23.6, at: 24.2, text: "링크 열어봤어요! 01:24:07 그 흰 화면 맞죠? 이제 이해됨 👍" },
  { id: "j1", author: "jiho", typing: 24.4, at: 24.9, text: "저도 봤어요. 안드로이드 크롬에서도 똑같이 번쩍여요" },
  { id: "d4", author: "minjun", typing: 24.8, at: 25.4, text: "같은 화면 보여요 🙌 이 링크 그대로 제 AI한테 넘길게요" },
  { id: "d5", author: "minjun", typing: 29.4, at: 30.0, text: "원인 찾았어요! 고쳐서 스테이징에 올렸어요 🚀" },
];
export const TOOLS = ["🔗 Agent Link 열기 · 최근 30초", "📋 events.json · 화면 변화 9건", "🖼 01:24:07 프레임 확대"];
export const ANALYSIS = "01:24:07에 페이지가 라이트 테마로 먼저 그려지고 0.2초 뒤 다크로 바뀝니다. ThemeProvider가 useEffect에서 dark 클래스를 붙여서, 첫 페인트가 늘 라이트예요.";
export const ANALYSIS_DONE = "테마 적용을 <head> 인라인 스크립트로 옮기면 첫 화면부터 다크로 그려집니다.";

export function chatAt(t: number): { messages: TeamMessage[]; typing: string | null } {
  const r = BEATS;
  const messages: { at: number; message: TeamMessage }[] = [];
  if (t >= r.send1) messages.push({ at: r.send1, message: { id: "m1", kind: "text", author: "me", text: PROMPT_1, image: true } });
  if (t >= r.send2) messages.push({ at: r.send2, message: { id: "m2", kind: "text", author: "me", text: PROMPT_2, image: false } });
  if (t >= r.send3) messages.push({ at: r.send3, message: {
    id: "m3", kind: "text", author: "me", text: SHARE_TEXT, image: false, views: viewersAt(t).length,
  } });
  for (const reply of REPLIES) if (t >= reply.at) messages.push({ at: reply.at, message: { id: reply.id, kind: "text", author: reply.author, text: reply.text, image: false } });
  const a = r.analysis;
  if (t >= a.thinking) messages.push({ at: a.thinking, message: {
    id: "ai", kind: "analysis", thinking: t < a.text[0], tools: TOOLS.filter((_, index) => t >= a.tools[index]),
    text: typed(ANALYSIS, a.text as [number, number], t), done: t >= a.done ? ANALYSIS_DONE : "", evidence: t >= a.text[1],
  } });
  messages.sort((left, right) => left.at - right.at);
  const typer = REPLIES.find((reply) => within(t, [reply.typing, reply.at]));
  return { messages: messages.map((entry) => entry.message), typing: typer ? TEAM[typer.author].name : null };
}

export function chatInputAt(t: number): { text: string; image: boolean; typing: boolean } {
  const r = BEATS;
  if (within(t, [r.pasteImage, r.send1])) return { text: typed(PROMPT_1, r.prompt1 as [number, number], t), image: true, typing: t >= r.prompt1[0] };
  if (within(t, [r.prompt2[0], r.send2])) return { text: typed(PROMPT_2, r.prompt2 as [number, number], t), image: false, typing: true };
  if (within(t, [r.pasted, r.send3])) return { text: SHARE_TEXT, image: false, typing: false };
  return { text: "", image: false, typing: false };
}

export const cardAt = (t: number): "dumb" | "smart" | null =>
  within(t, [REPLIES[2].at, REPLIES[2].at + 2.2]) ? "dumb" : within(t, [BEATS.analysis.card, BEATS.analysis.cardEnd]) ? "smart" : null;

// --- Pointer, keys, captions, sound -----------------------------------------

const CURSOR_KEYS: CursorKey[] = [
  { t: 0, x: 640, y: 560 },
  { t: 1.3, ...navCenter("리포트") },
  { t: 1.7, ...navCenter("리포트") },
  { t: 3.1, ...navCenter("설정") },
  { t: 3.5, ...navCenter("설정") },
  { t: 4.0, ...REST },
  { t: 4.6, ...REST },
  { t: 4.95, ...navCenter("리포트") },
  { t: 5.3, ...navCenter("리포트") },
  { t: 6.0, ...REST },
  { t: 6.6, ...INPUT_TARGET },
  { t: 8.6, ...INPUT_TARGET },
  { t: 8.75, ...SEND_BUTTON },
  { t: 12.0, ...SEND_BUTTON },
  { t: 12.4, ...REST },
  { t: 12.8, ...REST },
  { t: 13.1, ...INPUT_TARGET },
  { t: 13.6, ...INPUT_TARGET },
  { t: 13.75, ...SEND_BUTTON },
  { t: 18.2, ...SEND_BUTTON },
  { t: 18.5, ...QUICK_LINK },
  { t: 18.7, ...QUICK_LINK },
  { t: 19.2, ...PIP_EXPORT },
  { t: 20.4, ...PIP_EXPORT },
  { t: 20.8, ...COPY_BUTTON },
  { t: 21.1, ...COPY_BUTTON },
  { t: 21.5, ...INPUT_TARGET },
  { t: 22.0, ...INPUT_TARGET },
  { t: 22.35, ...SEND_BUTTON },
  { t: 31.3, ...SEND_BUTTON },
  { t: 31.7, ...navCenter("대시보드") },
  { t: 31.9, ...navCenter("대시보드") },
  { t: 32.5, ...navCenter("리포트") },
  { t: 32.7, ...navCenter("리포트") },
  { t: DURATION, ...REST },
];

export const CLICKS = [
  ...BEATS.navs.map(([at]) => at), BEATS.send1, BEATS.send2, BEATS.quickLink, BEATS.pipExport, BEATS.copy, BEATS.send3,
].sort((a, b) => a - b);
export const cursorAt = (t: number) => pointerAt(CURSOR_KEYS, CLICKS, [], t);

export function keysAt(t: number): { keys: string[]; note?: string } | null {
  const r = BEATS;
  if (captureAt(t).keys) return { keys: ["⊞ Win", "Shift", "S"] };
  if (within(t, [r.reload - 0.1, r.reload + 0.3])) return { keys: ["Ctrl", "Shift", "R"] };
  if (within(t, [r.pasteImage - 0.1, r.pasteImage + 0.25])) return { keys: ["Ctrl", "V"], note: "캡처 붙여넣기" };
  if (within(t, [r.pasteKeys, r.pasteKeys + 0.4])) return { keys: ["Ctrl", "V"], note: "링크 붙여넣기" };
  return null;
}

export const CAPTIONS: Caption[] = [
  { text: "디자인 QA 중… 방금 화면이 번쩍했는데?", start: 0.3, end: 3.2 },
  { text: "캡처하려고 하면 이미 지나가 있음", start: 3.3, end: 6.4 },
  { text: "보이는 그대로 팀 채팅에 설명", start: 6.5, end: 9.2 },
  { text: "“제 쪽에선 안 보이는데요?”", start: 9.3, end: 12.2 },
  { text: "새로고침해도 똑같은데…", start: 12.3, end: 14.2 },
  { text: "“AI도 코드상 정상이래요 🤔”", start: 14.3, end: 17.6 },
  { text: "방금그거뭐였지 2번 → 링크를 팀 채널에 그대로", start: 17.7, end: 22.6 },
  { text: "링크 하나로 팀 전원이 내 화면을 같이 봄 👀", start: 22.7, end: 25.5 },
  { text: "개발자는 같은 링크를 AI에게 그대로", start: 25.6, end: 29.5 },
  { text: "원인: 첫 화면이 라이트 테마로 그려지고 있었음", start: 29.6, end: 31.5 },
  { text: "배포 후: 더 이상 번쩍이지 않음", start: 31.6, end: 34.2 },
  { text: "내 화면, 링크 하나로 팀 전원에게", start: 34.3, end: 36.8 },
];
export const captionAt = (t: number) => captionIn(CAPTIONS, t);

export const SOUND_CUES: { at: number; sound: CueSound }[] = [
  ...CLICKS.map((at) => ({ at, sound: "click" as const })),
  ...BEATS.flashes.map((at) => ({ at, sound: "swish" as const })),
  ...BEATS.snips.map((at) => ({ at: at + SHOT_DELAY, sound: "shutter" as const })),
  ...REPLIES.map((reply) => ({ at: reply.at, sound: "pop" as const })),
  ...VIEWERS.map((viewer) => ({ at: viewer.at, sound: "pop" as const })),
  { at: BEATS.pasteImage, sound: "pop" },
  { at: BEATS.send1 + 0.1, sound: "pop" },
  { at: BEATS.send2 + 0.1, sound: "pop" },
  { at: BEATS.pip, sound: "pop" },
  { at: BEATS.exported, sound: "pop" },
  { at: BEATS.send3 + 0.1, sound: "pop" },
  { at: BEATS.analysis.card, sound: "ding" },
  { at: BEATS.clean, sound: "ding" },
];

export const TYPING: [number, number][] = [[...BEATS.prompt1] as [number, number], [...BEATS.prompt2] as [number, number]];
