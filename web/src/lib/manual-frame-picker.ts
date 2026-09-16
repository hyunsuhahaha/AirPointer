import type { OverviewFrame, PreviewFrame } from "./replay-buffer";

export type ManualFrame = {
  id: string;
  url: string;
  originalUrl: string;
  previewUrl: string;
  capturedAt: number;
  representative: boolean;
  highResolution: boolean;
  cropped?: boolean;
};
export type ManualGap = { id: string; frames: ManualFrame[] };
export type ManualTimeline = { representatives: ManualFrame[]; gaps: ManualGap[] };

export function buildManualTimeline(previews: PreviewFrame[], overview: OverviewFrame[]): ManualTimeline {
  const ordered = [...previews].sort((left, right) => left.capturedAt - right.capturedAt);
  const representatives = overview
    .flatMap((frame, index) => {
      const capturedAt = frame.capturedAt;
      if (capturedAt === undefined) return [];
      const previewUrl = nearestPreview(ordered, capturedAt)?.dataUrl ?? frame.url;
      return [{ id: `representative-${capturedAt}-${index}`, url: frame.url, originalUrl: frame.url, previewUrl, capturedAt, representative: true, highResolution: true }];
    })
    .sort((left, right) => left.capturedAt - right.capturedAt)
    // The ruler labels frames to the second, so two representatives from the
    // same second read as duplicates (typically right after sharing starts,
    // before there is enough history to spread them out). Keep the first.
    .filter((frame, index, all) => index === 0 || Math.floor(frame.capturedAt / 1_000) !== Math.floor(all[index - 1].capturedAt / 1_000));
  const gaps = representatives.slice(0, -1).map((frame, index) => {
    const next = representatives[index + 1];
    return {
      id: `gap-${frame.capturedAt}-${next.capturedAt}`,
      frames: ordered
        .filter((preview) => preview.capturedAt > frame.capturedAt + 125 && preview.capturedAt < next.capturedAt - 125)
        .map((preview, frameIndex) => ({
          id: `frame-${preview.capturedAt}-${frameIndex}`, url: preview.dataUrl, originalUrl: preview.dataUrl, previewUrl: preview.dataUrl,
          capturedAt: preview.capturedAt, representative: false, highResolution: false,
        })),
    };
  });
  return { representatives, gaps };
}

function nearestPreview(previews: PreviewFrame[], capturedAt: number) {
  return previews.reduce<PreviewFrame | undefined>((nearest, preview) => (
    !nearest || Math.abs(preview.capturedAt - capturedAt) < Math.abs(nearest.capturedAt - capturedAt) ? preview : nearest
  ), undefined);
}

// The frames the strip is actually showing, in the order it shows them:
// representatives, each followed by the in-between frames of its gap only
// while that gap is expanded. The enlarged view steps through this list, so
// "다음 화면" always means the next frame on screen -- the next in-between
// frame when the user has opened a gap, the next representative when they
// have not -- rather than the next frame in the underlying buffer.
export function visibleManualFrames(timeline: ManualTimeline, expandedGaps: ReadonlySet<string>): ManualFrame[] {
  return timeline.representatives.flatMap((frame, index) => {
    const gap = timeline.gaps[index];
    return gap && expandedGaps.has(gap.id) ? [frame, ...gap.frames] : [frame];
  });
}

export function manualFrameFile(frame: ManualFrame) {
  const [header, encoded] = frame.url.split(",", 2);
  const type = header.includes("png") ? "image/png" : "image/jpeg";
  const extension = type === "image/png" ? "png" : "jpg";
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  const stamp = new Date(frame.capturedAt).toISOString().replace(/[:.]/g, "-");
  return new File([bytes], `screen-${stamp}.${extension}`, { type });
}
