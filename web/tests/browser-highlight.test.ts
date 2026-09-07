import assert from "node:assert/strict";
import test from "node:test";
import { BrowserReplayBuffer } from "../src/lib/replay-buffer.ts";

test("highlight samples the whole screen and keeps a distinct pre-change frame", async (t) => {
  let changed = false;
  let now = 10_000;
  let capture = () => {};
  t.mock.method(Date, "now", () => now);
  const globals = ["document", "window", "MediaRecorder"] as const;
  const saved = globals.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  const buffer = new BrowserReplayBuffer(60_000);
  class Recorder {
    state = "inactive";
    static isTypeSupported() { return true; }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; }
  }
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: { setInterval: (fn: () => void) => { capture = fn; return 1; }, clearInterval() {}, setTimeout() {} } },
    MediaRecorder: { configurable: true, value: Recorder },
    document: { configurable: true, value: { createElement: (tag: string) => tag === "video"
      ? { readyState: 2, videoWidth: 1280, videoHeight: 720, play: async () => {}, pause() {} }
      : { width: 0, height: 0, toDataURL: () => changed ? "after" : "before", getContext: () => ({
        drawImage: (...args: unknown[]) => {
          if (args.length === 9) assert.deepEqual(args.slice(3, 5), [1280, 720], "detection must not crop to 1x1");
        },
        getImageData: () => {
          const data = new Uint8ClampedArray(160 * 90 * 4);
          if (changed) for (let y = 30; y < 55; y++) for (let x = 60; x < 100; x++) {
            const index = (y * 160 + x) * 4;
            data[index] = data[index + 1] = data[index + 2] = 255;
          }
          return { data };
        },
      }) } } },
  });
  try {
    buffer.start({} as MediaStream);
    await Promise.resolve();
    changed = true;
    for (let i = 0; i < 3; i++) { now += 250; capture(); }
    const highlight = buffer.recentHighlight(5);
    assert.ok(highlight);
    assert.equal(highlight.beforeUrl, "before");
    assert.equal(highlight.afterUrl, "after");
    assert.ok(highlight.bbox[0] > 0 && highlight.bbox[2] < 1, "localized bounds stay normalized");
  } finally {
    buffer.stop();
    globals.forEach((name, index) => {
      const descriptor = saved[index];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
});
