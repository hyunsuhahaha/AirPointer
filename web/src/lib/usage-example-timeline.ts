// Helpers shared by the usage-example scripts: every example is a pure
// function of the playhead `t` (script seconds) on a 1280×720 stage, with
// the Claudy chat on the right.

export const STAGE = { width: 1280, height: 720 };
export const CHAT = { x: 790, y: 70, width: 450, height: 600 };
export const CHAT_INPUT = { x: 806, y: 586, width: 418, height: 68 };
export const SEND_BUTTON = { x: 1196, y: 620 };
export const INPUT_TARGET = { x: CHAT_INPUT.x + 200, y: CHAT_INPUT.y + CHAT_INPUT.height / 2 };

export type Point = { x: number; y: number };
export type CueSound = "swish" | "click" | "pop" | "boing" | "whoosh" | "ding" | "shutter";
export type Caption = { text: string; start: number; end: number };

export const smooth = (u: number) => u * u * (3 - 2 * u);

// Text typed into a field between `start` and `end`.
export function typed(text: string, [start, end]: readonly [number, number], t: number) {
  if (t < start) return "";
  return text.slice(0, Math.round(Math.min(1, (t - start) / (end - start)) * text.length));
}

export function captionAt(captions: Caption[], t: number) {
  return captions.find((caption) => t >= caption.start && t < caption.end) ?? null;
}

export type CursorKey = Point & { t: number };

// A pointer that eases between keyframes, looks pressed around clicks and
// during `presses`, and shows a ripple for a moment after each click.
export function pointerAt(keys: CursorKey[], clicks: number[], presses: [number, number][], t: number) {
  let x = keys[0].x;
  let y = keys[0].y;
  for (let index = 1; index < keys.length; index++) {
    const [a, b] = [keys[index - 1], keys[index]];
    if (t <= b.t) {
      const u = b.t > a.t ? smooth(Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)))) : 1;
      x = a.x + (b.x - a.x) * u;
      y = a.y + (b.y - a.y) * u;
      break;
    }
    x = b.x; y = b.y;
  }
  const pressed = presses.some(([start, end]) => t >= start && t < end) || clicks.some((at) => t >= at - 0.06 && t < at + 0.06);
  const click = clicks.find((at) => t >= at && t < at + 0.45);
  return { x, y, pressed, clickAge: click === undefined ? null : t - click };
}

// A beat that shows for [start, end): true while inside.
export const within = (t: number, [start, end]: readonly [number, number]) => t >= start && t < end;
