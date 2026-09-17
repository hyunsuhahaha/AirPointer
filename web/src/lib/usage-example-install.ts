// Script for the infra engineer usage example (Local Folder). A three-minute
// install run fails at the last step; the cause is a warning that scrolled
// past at 01:12. A screenshot tool only catches the screen as it is now, so
// a web AI guesses from the final error. Local Folder saves the whole three
// minutes on disk; a local agent reads the frames and the recording, finds
// the warning, opens the config file on this PC and fixes it. Everything is a pure function of the playhead `t`.

import { INPUT_TARGET, SEND_BUTTON, captionAt as captionIn, pointerAt, typed, within } from "./usage-example-timeline.ts";
import type { Caption, CueSound, CursorKey } from "./usage-example-timeline.ts";

export const DURATION = 36;
export const SPEED = 1.25;

export const WORK = { x: 40, y: 70, width: 720, height: 600 };
const TERMINAL_CENTER = { x: WORK.x + 360, y: WORK.y + 300 };
const REST = { x: WORK.x + 560, y: WORK.y + 520 };

export const PIP = { x: 70, y: 236, width: 560, height: 424 };
export const QUICK_FOLDER = { x: PIP.x + 190 + 62, y: PIP.y + PIP.height - 78 + 30 + 24 };
export const RANGE_CHIPS = ["최근 1분", "최근 3분", "최근 5분"] as const;
export const rangeChip = (index: number) => ({ x: PIP.x + 16 + 50 + index * 108, y: PIP.y + 128 });
export const EXPORT_BUTTON = { x: PIP.x + 280, y: PIP.y + 184 };
export const COPY_BUTTON = { x: PIP.x + 280, y: PIP.y + 390 };

export const FOLDER = "Documents/Context-2026-09-17T01-24-08";
export const FOLDER_PROMPT = `로컬 파일시스템에서 저장 경로가 "${FOLDER}"로 끝나는 폴더를 찾아 주세요. context.md와 events.json을 읽은 뒤 captures 폴더의 화면을 시간순으로 확인해서 제가 무엇을 하고 있었는지 파악해 주세요.`;
export const WEB_PROMPT = "설치 가이드대로 했는데 마지막 curl이 실패해. 왜?";
// One preview a second (the default capture interval) over three minutes.
export const FRAMES_SAVED = 180;

export const BEATS = {
  install: [0.2, 5.6],
  scrollUp: [5.9, 7.2],
  snip: 7.7,
  paste: 8.4,
  webPrompt: [8.7, 9.5],
  webSend: 9.9,
  webReply: { thinking: 10.1, text: [10.5, 12.3], done: 12.5 },
  quickFolder: 13.6,
  range: 14.3,
  exportClick: 14.9,
  exporting: [15.0, 16.2],
  exported: 16.3,
  copy: 16.9,
  pipMinimize: 17.2,
  agent: 17.4,
  agentClick: 17.7,
  promptPaste: 17.9,
  enter: 18.3,
  steps: [18.7, 19.2, 19.7, 20.2, 20.9, 21.9, 22.6, 23.4, 24.5, 25.7],
  rerun: [24.5, 25.9],
  summary: [26.2, 28.2],
  board: 29.6,
  end: DURATION,
} as const;

// --- Terminal -------------------------------------------------------------------------

export type Line = { text: string; kind: "cmd" | "out" | "ok" | "warn" | "err" | "dim" };
type Step = { at: number; clock: string; cmd: string; out: Line[] };
export const INSTALL: Step[] = [
  { at: 0.4, clock: "00:03", cmd: "brew install kind helm kubectl", out: [{ text: "==> Pouring kind--0.24.0.arm64", kind: "dim" }, { text: "✓ kind, helm, kubectl installed", kind: "ok" }] },
  { at: 1.0, clock: "00:21", cmd: "kind create cluster --name dev --config kind-config.yaml", out: [{ text: " ✓ Ensuring node image (kindest/node:v1.31.0)", kind: "dim" }, { text: " ✓ Preparing nodes 📦", kind: "dim" }, { text: "Creating cluster \"dev\" ... done", kind: "ok" }] },
  { at: 1.6, clock: "00:48", cmd: "kubectl cluster-info --context kind-dev", out: [{ text: "Kubernetes control plane is running at https://127.0.0.1:52113", kind: "dim" }] },
  { at: 2.2, clock: "01:12", cmd: "helm install ingress ingress-nginx/ingress-nginx -n ingress --create-namespace", out: [
    { text: "WARNING: host port 80 is already in use (nginx) — ingress may be unreachable", kind: "warn" },
    { text: "NAME: ingress  STATUS: deployed  REVISION: 1", kind: "dim" },
    { text: "NOTES:", kind: "dim" },
    { text: "The ingress-nginx controller has been installed.", kind: "dim" },
    { text: "It may take a few minutes for the load balancer IP to be available.", kind: "dim" },
    { text: "  kubectl get svc -n ingress -w", kind: "dim" },
  ] },
  { at: 2.9, clock: "01:35", cmd: "kubectl apply -f k8s/api.yaml", out: [{ text: "configmap/api-env created", kind: "dim" }, { text: "deployment.apps/api created", kind: "dim" }, { text: "service/api created", kind: "dim" }] },
  { at: 3.4, clock: "01:58", cmd: "kubectl apply -f k8s/ingress.yaml", out: [{ text: "ingress.networking.k8s.io/api created", kind: "dim" }] },
  { at: 4.0, clock: "02:17", cmd: "kubectl rollout status deploy/api", out: [{ text: "Waiting for deployment \"api\" rollout to finish: 0 of 2 updated replicas are available...", kind: "dim" }, { text: "Waiting for deployment \"api\" rollout to finish: 1 of 2 updated replicas are available...", kind: "dim" }, { text: "deployment \"api\" successfully rolled out", kind: "ok" }] },
  { at: 4.6, clock: "02:39", cmd: "kubectl get pods", out: [
    { text: "NAME                   READY   STATUS    RESTARTS   AGE", kind: "dim" },
    { text: "api-7d9c8f6b5-k2x9p    1/1     Running   0          41s", kind: "dim" },
    { text: "api-7d9c8f6b5-q8wmz    1/1     Running   0          41s", kind: "dim" },
    { text: "redis-0                1/1     Running   0          58s", kind: "dim" },
    { text: "worker-5c6f9d-n7t2r    1/1     Running   0          40s", kind: "dim" },
  ] },
  { at: 5.1, clock: "02:58", cmd: "curl -i http://localhost/api/health", out: [{ text: "curl: (7) Failed to connect to localhost port 80: Connection refused", kind: "err" }] },
];
export const RERUN: { at: number; line: Line }[] = [
  { at: 24.5, line: { text: "$ kind delete cluster --name dev && kind create cluster --name dev --config kind-config.yaml", kind: "cmd" } },
  { at: 24.9, line: { text: "Creating cluster \"dev\" ... done", kind: "ok" } },
  { at: 25.2, line: { text: "$ helm install ingress ingress-nginx/ingress-nginx -n ingress --create-namespace", kind: "cmd" } },
  { at: 25.5, line: { text: "$ curl -i http://localhost:8081/api/health", kind: "cmd" } },
  { at: 25.9, line: { text: "HTTP/1.1 200 OK  {\"status\":\"ok\"}", kind: "ok" } },
];
export const VISIBLE_LINES = 20;

export function terminalAt(t: number): { lines: Line[]; clock: string; scrolledHint: boolean; warningVisible: boolean } {
  const all: Line[] = [];
  let clock = "00:00";
  for (const step of INSTALL) {
    if (t < step.at) break;
    clock = step.clock;
    all.push({ text: `$ ${step.cmd}`, kind: "cmd" });
    if (t >= step.at + 0.2) all.push(...step.out);
  }
  if (t >= RERUN[0].at) {
    all.push({ text: "", kind: "dim" });
    for (const item of RERUN) if (t >= item.at) all.push(item.line);
  }
  const lines = all.slice(-VISIBLE_LINES);
  return {
    lines, clock: t >= BEATS.install[1] ? "03:00" : clock,
    scrolledHint: within(t, BEATS.scrollUp),
    warningVisible: lines.some((line) => line.kind === "warn"),
  };
}

// --- Web AI -----------------------------------------------------------------------------

export const WEB_REPLY = "마지막 화면을 보면 localhost 80번 포트 연결이 거부됐네요. ingress 컨트롤러가 아직 준비되지 않았을 수 있어요. 몇 분 기다린 뒤 다시 시도해 보세요.";
export const WEB_DONE = "(첨부된 화면에는 설치 앞부분이 없어서 정확한 원인은 알기 어렵습니다)";
export function webChatAt(t: number) {
  const r = BEATS;
  const messages: { id: string; role: "user" | "ai"; text: string; images: number; thinking?: boolean; done?: string }[] = [];
  if (t >= r.webSend) messages.push({ id: "u1", role: "user", text: WEB_PROMPT, images: 1 });
  if (t >= r.webReply.thinking) messages.push({ id: "a1", role: "ai", text: typed(WEB_REPLY, r.webReply.text, t), images: 0, thinking: t < r.webReply.text[0], done: t >= r.webReply.done ? WEB_DONE : "" });
  return {
    messages,
    attached: within(t, [r.paste, r.webSend]) ? 1 : 0,
    input: within(t, [r.webPrompt[0], r.webSend]) ? typed(WEB_PROMPT, r.webPrompt, t) : "",
    typing: within(t, [r.webPrompt[0], r.webSend]),
  };
}

// The OS screenshot tool: one frame of the screen as it is right now.
export function snipAt(t: number) {
  return {
    keys: within(t, [BEATS.snip, BEATS.snip + 0.25]),
    flash: Math.max(0, 1 - Math.abs(t - (BEATS.snip + 0.25)) / 0.12),
    toast: within(t, [BEATS.snip + 0.3, BEATS.paste + 0.6]),
  };
}

// --- Local Folder PiP ---------------------------------------------------------------------

export type PipState = { visible: boolean; minimized: boolean; folder: boolean; range: number; exporting: number | null; exported: boolean; copied: boolean; quickPressed: boolean };
export function pipAt(t: number): PipState {
  const r = BEATS;
  const u = within(t, r.exporting) ? (t - r.exporting[0]) / (r.exporting[1] - r.exporting[0]) : null;
  return {
    visible: t < r.board,
    minimized: t < r.quickFolder + 0.05 || t >= r.pipMinimize,
    folder: t >= r.quickFolder + 0.05,
    range: t >= r.range ? 1 : 0,
    exporting: u,
    exported: t >= r.exported,
    copied: t >= r.copy + 0.05,
    quickPressed: within(t, [r.quickFolder - 0.06, r.quickFolder + 0.05]),
  };
}

// --- Local agent --------------------------------------------------------------------------

export type AgentStep = { tool: string; detail: string; kind?: "find" | "local" | "edit" | "ok" };
export const AGENT_STEPS: AgentStep[] = [
  { tool: "Read", detail: `${FOLDER}/context.md` },
  { tool: "Read", detail: "events.json · 화면 변화 64건 (01:24:08 기준 최근 3분)" },
  { tool: "Glob", detail: `captures/preview/*.jpg → ${FRAMES_SAVED}장 · recording/*.webm → 6조각` },
  { tool: "Read", detail: "captures/preview/2026-09-17T01-22-20Z.jpg · 01:12에 노란 줄 · 글씨가 작음" },
  { tool: "Bash", detail: "ffmpeg -ss 00:00:12 -i recording/segment-03.webm -frames:v 1 warn.png → 원본 해상도", kind: "find" },
  { tool: "Read", detail: "~/infra/kind-config.yaml · hostPort: 80", kind: "local" },
  { tool: "Bash", detail: "sudo lsof -i :80 → nginx (pid 812) 이 80번 포트 사용 중", kind: "local" },
  { tool: "Edit", detail: "kind-config.yaml · hostPort: 80 → 8081", kind: "edit" },
  { tool: "Bash", detail: "kind 클러스터 재생성 · ingress 재설치", kind: "local" },
  { tool: "Bash", detail: "curl localhost:8081/api/health → 200 OK", kind: "ok" },
];
export const AGENT_SUMMARY = "원인은 설치 1분 12초에 지나간 경고였어요. 이 PC의 nginx가 80번 포트를 쓰고 있어서 ingress가 연결되지 않았습니다. kind-config.yaml의 hostPort를 8081로 바꾸고 클러스터를 다시 만들었어요. 이제 http://localhost:8081 로 접속하세요.";

export function agentAt(t: number) {
  const r = BEATS;
  return {
    visible: t >= r.agent,
    input: within(t, [r.promptPaste, r.enter]) ? FOLDER_PROMPT : "",
    prompt: t >= r.enter ? FOLDER_PROMPT : "",
    steps: AGENT_STEPS.filter((_, index) => t >= r.steps[index]),
    running: t >= r.enter && t < r.summary[0],
    summary: typed(AGENT_SUMMARY, r.summary, t),
    sentNothing: t >= r.steps[r.steps.length - 1],
  };
}

// --- Board --------------------------------------------------------------------------------

export const COMPARISON: { label: string; before: string; after: string }[] = [
  { label: "AI가 볼 수 있는 화면", before: "마지막 캡처 1장", after: `3분 전체 · ${FRAMES_SAVED}장 + 녹화 원본` },
  { label: "1분 12초에 지나간 경고", before: "이미 스크롤 밖", after: "기록에서 찾음" },
  { label: "내 PC의 설정 파일", before: "AI가 못 봄", after: "에이전트가 직접 수정" },
  { label: "외부로 나간 화면", before: "웹 AI에 업로드", after: "0건" },
];
export const boardRowsAt = (t: number) => t < BEATS.board ? 0 : Math.min(COMPARISON.length, Math.floor((t - BEATS.board) / 0.35) + 1);

// --- Pointer, keys, captions, sound --------------------------------------------------------

const CURSOR_KEYS: CursorKey[] = [
  { t: 0, ...REST },
  { t: 7.4, ...TERMINAL_CENTER },
  { t: 8.0, ...TERMINAL_CENTER },
  { t: 8.3, ...INPUT_TARGET },
  { t: 9.7, ...INPUT_TARGET },
  { t: 9.85, ...SEND_BUTTON },
  { t: 13.2, ...SEND_BUTTON },
  { t: 13.5, ...QUICK_FOLDER },
  { t: 13.7, ...QUICK_FOLDER },
  { t: 14.15, ...rangeChip(1) },
  { t: 14.4, ...rangeChip(1) },
  { t: 14.8, ...EXPORT_BUTTON },
  { t: 16.4, ...EXPORT_BUTTON },
  { t: 16.8, ...COPY_BUTTON },
  { t: 17.0, ...COPY_BUTTON },
  { t: 17.6, ...INPUT_TARGET },
  { t: 18.5, ...INPUT_TARGET },
  { t: 19.2, ...REST },
  { t: DURATION, ...REST },
];
export const CLICKS = [BEATS.webSend, BEATS.quickFolder, BEATS.range, BEATS.exportClick, BEATS.copy, BEATS.agentClick];
export const cursorAt = (t: number) => pointerAt(CURSOR_KEYS, CLICKS, [], t);

export function keysAt(t: number): { keys: string[]; note?: string } | null {
  if (within(t, BEATS.scrollUp)) return { keys: ["Shift", "PgUp"], note: "1,284줄 위 어딘가…" };
  if (within(t, [BEATS.snip, BEATS.snip + 0.25])) return { keys: ["⊞ Win", "Shift", "S"], note: "지금 화면 한 장" };
  if (within(t, [BEATS.paste - 0.1, BEATS.paste + 0.3])) return { keys: ["Ctrl", "V"], note: "캡처 1장" };
  if (within(t, [BEATS.promptPaste - 0.1, BEATS.promptPaste + 0.3])) return { keys: ["Ctrl", "V"], note: "폴더 경로 프롬프트" };
  if (within(t, [BEATS.enter - 0.1, BEATS.enter + 0.25])) return { keys: ["Enter"] };
  return null;
}

export const CAPTIONS: Caption[] = [
  { text: "설치 가이드대로 명령어를 3분 동안…", start: 0.2, end: 5.0 },
  { text: "마지막 단계에서 실패. 원인은 이미 스크롤 위로", start: 5.1, end: 7.5 },
  { text: "캡처 도구로 찍을 수 있는 건 지금 화면 한 장뿐", start: 7.6, end: 10.0 },
  { text: "AI는 마지막 화면만 보고 추측한다", start: 10.1, end: 13.2 },
  { text: "방금그거뭐였지 3번 → 최근 3분을 내 PC 폴더에 통째로", start: 13.3, end: 17.3 },
  { text: "로컬 에이전트에는 폴더 경로만 붙여넣기", start: 17.4, end: 18.9 },
  { text: `에이전트가 3분치 화면 ${FRAMES_SAVED}장과 녹화를 훑어서`, start: 19.0, end: 21.8 },
  { text: "1분 12초에 지나간 경고를 찾고, 내 PC 설정까지 고친다", start: 21.9, end: 25.8 },
  { text: "외부 전송 0건 · 설치 성공", start: 25.9, end: 29.4 },
  { text: "긴 과정도, 내 PC 안에서 통째로", start: 29.8, end: 35.8 },
];
export const captionAt = (t: number) => captionIn(CAPTIONS, t);

export const SOUND_CUES: { at: number; sound: CueSound }[] = [
  ...CLICKS.map((at) => ({ at, sound: "click" as const })),
  ...INSTALL.map((step) => ({ at: step.at, sound: "pop" as const })),
  { at: INSTALL[INSTALL.length - 1].at + 0.2, sound: "boing" },
  { at: BEATS.snip + 0.25, sound: "shutter" },
  { at: BEATS.paste, sound: "pop" },
  { at: BEATS.webSend + 0.1, sound: "pop" },
  { at: BEATS.exported, sound: "pop" },
  { at: BEATS.enter, sound: "whoosh" },
  { at: BEATS.steps[4], sound: "ding" },
  { at: BEATS.steps[9], sound: "ding" },
  { at: BEATS.board, sound: "whoosh" },
];

export const TYPING: [number, number][] = [[...BEATS.webPrompt]];
