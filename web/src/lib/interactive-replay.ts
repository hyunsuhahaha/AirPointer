import type { NormalizedBox, OverviewFrame } from "./replay-buffer";

export type RecordedScene = { url: string; at: number; focusBox?: NormalizedBox };

/** A frozen history of actual rendered canvas states, not a synthetic scenario clock. */
export class InteractiveReplay {
  readonly scenes: RecordedScene[];
  readonly seconds: number;
  readonly triggeredAt: number;
  readonly width: number;
  readonly height: number;
  constructor(scenes: RecordedScene[], triggeredAt: number, width: number, height: number) {
    this.triggeredAt = triggeredAt; this.width = width; this.height = height;
    const ordered = scenes.filter(s => s.at <= triggeredAt).sort((a, b) => a.at - b.at);
    const boundary = triggeredAt - 60_000;
    const preceding = ordered.findLast(s => s.at < boundary);
    this.scenes = [...(preceding ? [{ ...preceding, at: boundary }] : []), ...ordered.filter(s => s.at >= boundary)];
    this.seconds = this.scenes.length ? (triggeredAt - this.scenes[0].at) / 1000 : 0;
  }

  atOffsets(offsets: number[], kind: OverviewFrame["kind"] = "queried-frame"): OverviewFrame[] {
    return offsets.flatMap(offset => {
      const seconds = Math.abs(offset);
      if (seconds > this.seconds + 0.001) return [];
      const at = this.triggeredAt - seconds * 1000;
      const scene = this.scenes.findLast(s => s.at <= at + 0.5);
      if (!scene) return [];
      return [{ url: scene.url, atSeconds: seconds, capturedAt: at, kind,
        sampleOffsetsSeconds: [seconds], focusBox: scene.focusBox,
        // The sandbox contains only local development fixtures; automatic OCR still runs.
      }];
    });
  }

  overview(): OverviewFrame[] {
    // Uniform temporal samples. The brief alert is not privileged by its known location.
    return this.atOffsets(Array.from({ length: 6 }, (_, i) => -this.seconds * (1 - i / 5)), "replay-frame");
  }
}
