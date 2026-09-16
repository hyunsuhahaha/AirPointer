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
    .sort((left, right) => left.capturedAt - right.capturedAt);
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

export function manualFrameFile(frame: ManualFrame) {
  const [header, encoded] = frame.url.split(",", 2);
  const type = header.includes("png") ? "image/png" : "image/jpeg";
  const extension = type === "image/png" ? "png" : "jpg";
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  const stamp = new Date(frame.capturedAt).toISOString().replace(/[:.]/g, "-");
  return new File([bytes], `screen-${stamp}.${extension}`, { type });
}
