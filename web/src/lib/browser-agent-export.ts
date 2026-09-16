import { selectNotable } from "./replay-buffer.ts";
import type { BrowserReplayBuffer, ChangeEvent, OverviewFrame, PreviewFrame, ReplayCapsule } from "./replay-buffer";

export type AgentExportMode = "complete" | "attach";

export type AgentExportResult = { fileName: string; imageCount: number; prompt: string };
export type AgentExportBundle = AgentExportResult & { files: File[] };

function stamp(at: number) {
  return new Date(at).toISOString().replace(/[:.]/g, "-");
}

function imageBlob(dataUrl: string) {
  const [header, data] = dataUrl.split(",", 2);
  const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: header.includes("png") ? "image/png" : "image/jpeg" });
}

export function exportContextDocument(capsule: ReplayCapsule, frames: OverviewFrame[], events: ChangeEvent[],
  mode: AgentExportMode, batchName = "") {
  const start = new Date(capsule.startedAt).toISOString();
  const end = new Date(capsule.triggeredAt).toISOString();
  const images = frames.map((frame, index) =>
    `- ${new Date(frame.capturedAt ?? capsule.triggeredAt).toISOString()} · ${mode === "complete" ? "captures/" : `${batchName}-`}${String(index + 1).padStart(2, "0")}-${stamp(frame.capturedAt ?? capsule.triggeredAt)}.jpg`);
  const changes = events.map((event) =>
    `- ${new Date(event.peakAt).toISOString()} · 화면 변화 감지 (강도 ${event.peakScore.toFixed(3)}, 영역 ${event.bbox.map((n) => n.toFixed(2)).join(", ")})`);
  return `# 화면 맥락 기록\n\n기록 구간: ${start} ~ ${end}\n\n## 화면 변화\n\n${changes.join("\n") || "- 감지된 화면 변화 없음"}\n\n## 대표 화면\n\n${images.join("\n") || "- 대표 화면 없음"}${mode === "complete" ? "\n\n## 전체 자료\n\n- events.json: 화면 변화 기록\n- captures/preview/: 실제 주기 화면\n- captures/: 프리뷰에서 선별한 대표 화면\n- recording/: WebM 영상 조각\n" : "\n"}`;
}

async function bundleSnapshot(mode: AgentExportMode,
  capsule: ReplayCapsule, captures: PreviewFrame[], events: ChangeEvent[], frames: OverviewFrame[]): Promise<AgentExportBundle> {
  if (!frames.length) throw new Error("대표 화면을 읽지 못했습니다. 잠시 후 다시 눌러 주세요.");
  if (mode === "attach" && frames.length < 6) throw new Error("파일 첨부에는 화면 6장이 필요합니다. 화면을 조금 더 기록한 뒤 다시 눌러 주세요.");
  const batchName = `Export-${stamp(capsule.triggeredAt)}`;
  const fileName = mode === "complete" ? `Context-${stamp(capsule.triggeredAt)}` : batchName;
  const files: { name: string; data: Blob }[] = [];
  for (const [index, frame] of frames.entries()) {
    files.push({ name: `${mode === "complete" ? "captures/" : `${batchName}-`}${String(index + 1).padStart(2, "0")}-${stamp(frame.capturedAt ?? capsule.triggeredAt)}.jpg`, data: imageBlob(frame.url) });
  }
  if (mode === "complete") {
    files.push({ name: "events.json", data: new Blob([JSON.stringify({ source: "visual_change", startedAt: capsule.startedAt, triggeredAt: capsule.triggeredAt,
      events: events.map(({ startedAt, peakAt, endedAt, peakScore, bbox, extent }) => ({ startedAt, peakAt, endedAt, peakScore, bbox, extent })) }, null, 2)], { type: "application/json" }) });
    for (const capture of captures) {
      files.push({ name: `captures/preview/${stamp(capture.capturedAt)}.jpg`, data: imageBlob(capture.dataUrl) });
    }
    for (const [index, segment] of capsule.segments.entries()) {
      files.push({ name: `recording/${String(index + 1).padStart(3, "0")}-${stamp(segment.startedAt)}.webm`, data: segment.blob });
    }
  }
  files.unshift({ name: `${mode === "complete" ? "" : `${batchName}-`}context.md`, data: new Blob([exportContextDocument(capsule, frames, events, mode, batchName)], { type: "text/markdown;charset=utf-8" }) });
  return {
    fileName,
    imageCount: frames.length,
    files: files.map(({ name, data }) => new File([data], name, { type: data.type })),
    prompt: mode === "complete"
      ? "이 화면 기록과 변화 메타데이터를 살펴봐 주세요."
      : `첨부한 ${batchName}-context.md와 화면 이미지 ${frames.length}장을 시간순으로 살펴봐 주세요. 직전 화면 흐름과 현재 상황을 파악하고, 화면 근거를 짚어 답해 주세요.`,
  };
}

export async function exportAgentContext(buffer: BrowserReplayBuffer,
  mode: AgentExportMode, seconds: number, _surface: string): Promise<AgentExportBundle> {
  void _surface;
  const capsule = await buffer.recentCapsule(seconds, 12);
  if (!capsule.segments.length) throw new Error("내보낼 화면 기록이 없습니다. 화면을 공유한 뒤 다시 눌러 주세요.");
  const { captures, events } = buffer.exportMetadata(capsule);
  // The periodic previews come directly from the shared screen. Prefer them
  // because decoding short WebM segments can occasionally produce black frames.
  const notable = selectNotable(captures, events, 12);
  const frames = notable.length >= 6 ? await upgradeFrames(buffer, capsule, notable) : capsule.overviewFrames;
  return bundleSnapshot(mode, capsule, captures, events, frames);
}

// Previews are small, low-quality thumbnails. Swap each for a full-resolution
// frame decoded from the recording, keeping the preview when decoding fails
// or yields the occasional black frame.
async function upgradeFrames(buffer: BrowserReplayBuffer, capsule: ReplayCapsule, notable: PreviewFrame[]): Promise<OverviewFrame[]> {
  const offsets = notable.map(({ capturedAt }) => (capturedAt - capsule.triggeredAt) / 1_000);
  let decoded: OverviewFrame[] = [];
  try { decoded = await buffer.framesAtOffsets(capsule, offsets, "queried-frame"); } catch { /* Previews still work. */ }
  // Frames outside any segment are dropped, so match by time, not position.
  const byTime = new Map(decoded.map((frame) => [Math.round(frame.capturedAt ?? 0), frame]));
  return Promise.all(notable.map(async ({ dataUrl, capturedAt }, index) => {
    const high = byTime.get(Math.round(capturedAt));
    const url = high && !(await isMostlyBlack(high.url)) ? high.url : dataUrl;
    return { url, capturedAt, atSeconds: (capsule.triggeredAt - capturedAt) / 1_000, sampleOffsetsSeconds: [offsets[index]], kind: "replay-frame" as const };
  }));
}

async function isMostlyBlack(dataUrl: string) {
  try {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 16; canvas.height = 9;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(image, 0, 0, 16, 9);
    const pixels = context.getImageData(0, 0, 16, 9).data;
    let brightest = 0;
    for (let index = 0; index < pixels.length; index += 4) brightest = Math.max(brightest, pixels[index], pixels[index + 1], pixels[index + 2]);
    return brightest < 12;
  } catch { return true; }
}
