// Scripts for the lobby's 10-second "how to use" clips, one per delivery
// mode. Each clip is a pure function of the playhead `t` on a 640×360 stage:
// the work window on the left with the PiP over it, an AI chat on the right.

import { pointerAt } from "./usage-example-timeline.ts";
import type { CursorKey } from "./usage-example-timeline.ts";

export type QuickMode = "manual" | "link" | "folder";

export const QUICK_STAGE = { width: 640, height: 360 };
export const DURATION = 9.6;
export const WORK = { x: 16, y: 16, width: 380, height: 328 };
export const CHAT = { x: 412, y: 16, width: 212, height: 328 };
export const CHAT_INPUT = { x: 420, y: 290, width: 196, height: 46 };
export const SEND = { x: 600, y: 313 };
export const PIP = { x: 28, y: 118, width: 356, height: 214 };
export const PIP_BAR = { x: 28, y: 292, width: 250, height: 40 };
// Minimized bar's 1·2·3 buttons, in Manual, Agent Link, Local Folder order.
export const quickButton = (index: number) => ({ x: PIP_BAR.x + 128 + index * 28, y: PIP_BAR.y + PIP_BAR.height / 2 });
export const EXPORT_BUTTON = { x: PIP.x + 12, y: PIP.y + 96, width: PIP.width - 24, height: 32 };
export const COPY_BUTTON = { x: PIP.x + 12, y: PIP.y + 184, width: PIP.width - 24, height: 24 };
// Agent Link's checkout page: the pay button that fails.
export const PAY_BUTTON = { x: WORK.x + 20, y: WORK.y + 206, width: WORK.width - 40, height: 34 };
export const FOLDER_BUTTON = { x: PIP.x + PIP.width - 100, y: PIP.y + 62, width: 88, height: 24 };
// Manual strip: representative frames with a "…" gap that opens into the
// in-between frames. The picked frame is the first in-between one.
export const STRIP = { left: PIP.x + 12, top: PIP.y + 78, frame: 50, height: 32, gap: 22, spacing: 6 };
const INPUT_POINT = { x: CHAT_INPUT.x + 80, y: CHAT_INPUT.y + CHAT_INPUT.height / 2 };
const center = (rect: { x: number; y: number; width: number; height: number }) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

export const STEP_STARTS = [0, 2, 5];
export const STEPS: Record<QuickMode, string[]> = {
  manual: ["기록을 켜 두고, 필요할 때 1번", "… 를 펼쳐 놓친 화면 고르기", "AI 입력창에 끌어다 놓기"],
  link: ["기록을 켜 두고, 필요할 때 2번", "AI Context 생성 → 프롬프트 복사", "AI에 붙여넣으면 링크를 열어 읽어요"],
  folder: ["기록을 켜 두고, 필요할 때 3번", "폴더 고르고 AI Context 생성 → 복사", "로컬 에이전트가 폴더를 찾아 읽어요"],
};
// Manual's lecture: the command slide (index 2) is up for barely half a second.
export const slideAt = (t: number) => t < 0.4 ? 0 : t < 0.8 ? 1 : t < 1.4 ? 2 : t < 1.9 ? 3 : 4;
export const stepAt = (t: number) => STEP_STARTS.filter((start) => t >= start).length - 1;

type Script = { keys: CursorKey[]; clicks: number[]; presses: [number, number][] };
const pickedFrame = { x: STRIP.left + 2 * (STRIP.frame + STRIP.spacing) + STRIP.frame / 2, y: STRIP.top + STRIP.height / 2 };
const gapPoint = { x: STRIP.left + 2 * (STRIP.frame + STRIP.spacing) + STRIP.gap / 2, y: STRIP.top + STRIP.height / 2 };
const exportPoint = center(EXPORT_BUTTON);
const copyPoint = center(COPY_BUTTON);

export const SCRIPTS: Record<QuickMode, Script> = {
  manual: {
    keys: [{ t: 0, x: 250, y: 200 }, { t: 0.5, x: 250, y: 200 }, { t: 1.5, ...quickButton(0) }, { t: 2.8, ...gapPoint }, { t: 3.9, ...pickedFrame }, { t: 5.0, ...pickedFrame }, { t: 6.5, ...INPUT_POINT }, { t: 7.3, ...SEND }],
    clicks: [1.8, 3.0, 4.2, 7.5],
    presses: [[5.0, 6.7]],
  },
  link: {
    keys: [{ t: 0, x: 300, y: 300 }, { t: 0.35, ...center(PAY_BUTTON) }, { t: 0.9, ...center(PAY_BUTTON) }, { t: 1.25, ...quickButton(1) }, { t: 2.3, ...exportPoint }, { t: 4.1, ...copyPoint }, { t: 5.2, ...INPUT_POINT }, { t: 6.4, ...INPUT_POINT }, { t: 6.9, ...SEND }],
    clicks: [0.5, 1.4, 2.5, 4.3, 5.3, 7.0],
    presses: [],
  },
  folder: {
    keys: [{ t: 0, x: 250, y: 200 }, { t: 0.4, x: 250, y: 200 }, { t: 1.2, ...quickButton(2) }, { t: 2.2, ...center(FOLDER_BUTTON) }, { t: 2.9, ...exportPoint }, { t: 4.3, ...copyPoint }, { t: 5.3, ...INPUT_POINT }],
    clicks: [1.4, 2.4, 3.1, 4.5, 5.4],
    presses: [],
  },
};

export const pointerFor = (mode: QuickMode, t: number) => {
  const script = SCRIPTS[mode];
  return pointerAt(script.keys, script.clicks, script.presses, t);
};

// When the PiP opens from its minimized bar, and the beats after it.
export const TIMES: Record<QuickMode, { open: number; export?: [number, number]; copied?: number; folder?: number; expand?: number; pick?: number; drop?: number; paste?: number; send: number; work: [number, number][]; answer: number }> = {
  manual: { open: 2.0, expand: 3.05, pick: 4.25, drop: 6.7, send: 7.55, work: [], answer: 8.4 },
  link: { open: 1.6, export: [2.55, 3.4], copied: 4.35, paste: 5.7, send: 7.05, work: [[7.3, 8.1]], answer: 8.1 },
  folder: { open: 1.6, folder: 2.45, export: [3.15, 3.8], copied: 4.55, paste: 5.7, send: 6.5, work: [[6.8, 9.6], [7.25, 9.6], [7.7, 9.6]], answer: 8.3 },
};
