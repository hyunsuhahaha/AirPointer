import type { OverviewFrame, PreviewFrame } from "./replay-buffer";

export type ManualFrame = { id: string; url: string; capturedAt: number; representative: boolean };
export type ManualGap = { id: string; frames: ManualFrame[] };
export type ManualTimeline = { representatives: ManualFrame[]; gaps: ManualGap[] };

export function buildManualTimeline(previews: PreviewFrame[], overview: OverviewFrame[]): ManualTimeline {
  const ordered = [...previews].sort((left, right) => left.capturedAt - right.capturedAt);
  const representatives = overview
    .flatMap((frame, index) => {
      if (frame.capturedAt === undefined) return [];
      const nearest = ordered.reduce<PreviewFrame | null>((best, preview) => !best || Math.abs(preview.capturedAt - frame.capturedAt) < Math.abs(best.capturedAt - frame.capturedAt) ? preview : best, null);
      return [{ id: `representative-${frame.capturedAt}-${index}`, url: nearest?.dataUrl ?? frame.url, capturedAt: frame.capturedAt, representative: true }];
    })
    .sort((left, right) => left.capturedAt - right.capturedAt);
  const gaps = representatives.slice(0, -1).map((frame, index) => {
    const next = representatives[index + 1];
    return {
      id: `gap-${frame.capturedAt}-${next.capturedAt}`,
      frames: ordered
        .filter((preview) => preview.capturedAt > frame.capturedAt + 125 && preview.capturedAt < next.capturedAt - 125)
        .map((preview, frameIndex) => ({
          id: `frame-${preview.capturedAt}-${frameIndex}`, url: preview.dataUrl, capturedAt: preview.capturedAt, representative: false,
        })),
    };
  });
  return { representatives, gaps };
}

export function manualFrameFile(frame: ManualFrame) {
  const [header, encoded] = frame.url.split(",", 2);
  const type = header.includes("png") ? "image/png" : "image/jpeg";
  const extension = type === "image/png" ? "png" : "jpg";
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  const stamp = new Date(frame.capturedAt).toISOString().replace(/[:.]/g, "-");
  return new File([bytes], `screen-${stamp}.${extension}`, { type });
}
