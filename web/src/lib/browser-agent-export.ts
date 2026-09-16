import { ChangeTracker, selectNotable } from "./replay-buffer.ts";
import type { BrowserReplayBuffer, ChangeEvent, OverviewFrame, PreviewFrame, ReplayCapsule } from "./replay-buffer";
import type { InteractiveReplay } from "./interactive-replay";
import type { DemoScenario } from "./demo-replay";

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
  const frames = notable.length >= 6 ? notable.map(({ dataUrl, capturedAt }) => ({
      url: dataUrl, capturedAt, atSeconds: (capsule.triggeredAt - capturedAt) / 1_000, kind: "replay-frame" as const,
    })) : capsule.overviewFrames;
  return bundleSnapshot(mode, capsule, captures, events, frames);
}

export async function exportDemoAgentContext(replay: InteractiveReplay, scenario: DemoScenario,
  mode: AgentExportMode, seconds: number): Promise<AgentExportBundle> {
  const response = await fetch(scenario.video);
  if (!response.ok) throw new Error("체험 녹화 파일을 읽지 못했습니다.");
  const video = await response.blob();
  const windowSeconds = Math.min(seconds, replay.seconds);
  const capsule: ReplayCapsule = { overviewFrames: [], startedAt: replay.triggeredAt - windowSeconds * 1_000,
    triggeredAt: replay.triggeredAt, segments: [{ blob: video, startedAt: replay.triggeredAt - replay.seconds * 1_000, durationMs: replay.seconds * 1_000 }] };
  const captures = replay.scenes.filter(({ at }) => at >= capsule.startedAt).map(({ url, at }) => ({ dataUrl: url, capturedAt: at }));
  const tracker = new ChangeTracker();
  const events: ChangeEvent[] = [];
  for (const capture of captures) {
    const bitmap = await createImageBitmap(imageBlob(capture.dataUrl));
    try {
      const event = tracker.observe(bitmap, bitmap.width, bitmap.height, capture.capturedAt);
      if (event) events.push({ ...event, bbox: [event.bbox[0] / bitmap.width, event.bbox[1] / bitmap.height,
        event.bbox[2] / bitmap.width, event.bbox[3] / bitmap.height] });
    } finally { bitmap.close(); }
  }
  const notable = selectNotable(captures, events, 12);
  const frames = (notable.length >= 6 ? notable.map(({ dataUrl, capturedAt }) => ({ url: dataUrl, capturedAt })) :
    replay.atOffsets(Array.from({ length: 12 }, (_, index) => -windowSeconds * (1 - index / 11))).map(({ url, capturedAt }) => ({ url, capturedAt: capturedAt ?? replay.triggeredAt }))).map(({ url, capturedAt }) => ({
    url, capturedAt, atSeconds: (replay.triggeredAt - capturedAt) / 1_000, kind: "replay-frame" as const,
  }));
  return bundleSnapshot(mode, capsule, captures, events, frames);
}
