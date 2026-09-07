export type AnalysisPayload = {
  mode: "current" | "replay" | "text";
  frames: string[];
  metadata?: CaptureMetadata;
  question?: string;
  history?: { role: "user" | "assistant"; text: string }[];
};

export function isAnalysisPayload(value: unknown): value is AnalysisPayload {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.frames) || !body.frames.every((frame) => typeof frame === "string" && /^data:image\/(jpeg|png);base64,/.test(frame))) return false;
  if (body.metadata !== undefined && !isCaptureMetadata(body.metadata, body.frames.length)) return false;
  if (body.mode === "text" && body.metadata !== undefined) return false;
  if (body.question !== undefined && typeof body.question !== "string") return false;
  if (body.history !== undefined && (!Array.isArray(body.history) || !body.history.every((turn) =>
    turn && typeof turn === "object" && (turn.role === "user" || turn.role === "assistant") && typeof turn.text === "string"))) return false;
  return body.mode === "text"
    ? body.frames.length === 0 && typeof body.question === "string" && Boolean(body.question.trim()) && Array.isArray(body.history) && body.history.some((turn) => turn.role === "assistant" && turn.text.trim())
    : (body.mode === "current" || body.mode === "replay") && body.frames.length > 0;
}

export type CaptureMetadata = {
  capturedAt: number;
  surface: "browser" | "window" | "monitor" | "unknown";
  width: number;
  height: number;
  requestedSeconds: number;
  selection?: [number, number, number, number];
  images: { kind: "screen" | "contact-sheet" | "selection" | "change-crop"; offsetsSeconds: number[] }[];
};

export type CaptureSnapshot = { url: string; capturedAt: number; width: number; height: number; surface: CaptureMetadata["surface"]; selection?: CaptureMetadata["selection"] };

function isCaptureMetadata(value: unknown, count: number): value is CaptureMetadata {
  if (!value || typeof value !== "object") return false;
  const m = value as CaptureMetadata;
  const finite = (n: unknown, max: number) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= max;
  return finite(m.capturedAt, 8.64e15) && m.capturedAt > 0
    && ["browser", "window", "monitor", "unknown"].includes(m.surface)
    && finite(m.width, 100000) && m.width > 0 && finite(m.height, 100000) && m.height > 0
    && finite(m.requestedSeconds, 3600)
    && (m.selection === undefined || (Array.isArray(m.selection) && m.selection.length === 4 && m.selection.every(n => finite(n, 1)) && m.selection[0] < m.selection[2] && m.selection[1] < m.selection[3]))
    && Array.isArray(m.images) && m.images.length === count && count <= 6
    && m.images.every(i => i && ["screen", "contact-sheet", "selection", "change-crop"].includes(i.kind) && Array.isArray(i.offsetsSeconds) && i.offsetsSeconds.length <= 10 && i.offsetsSeconds.every(n => finite(n, 3600)));
}

// This exact text is included in the model input and returned as a delivery receipt.
export function formatCaptureMetadata(m?: CaptureMetadata): string {
  if (!m) return "";
  const kinds = { screen: "현재 화면", "contact-sheet": "시간순 모음 (왼쪽→오른쪽, 위→아래)", selection: "선택 영역", "change-crop": "변화 확대 (시각 미확인)" };
  return [
    "브라우저 캡처 정보",
    `기준 시각: ${new Date(m.capturedAt).toISOString()}`,
    `공유 대상: ${m.surface} · 원본: ${m.width} × ${m.height}px`,
    `요청 구간: 최근 ${m.requestedSeconds}초 (실제 표본 시각은 아래 참조)`,
    m.selection ? `사용자 선택 영역 [좌, 상, 우, 하; 원본 대비 0~1]: ${m.selection.join(", ")}` : "",
    ...m.images.map((i, index) => `이미지 ${index + 1}: ${kinds[i.kind]}${i.offsetsSeconds.length ? ` · 기준 시각보다 ${i.offsetsSeconds.map(n => n.toFixed(2)).join(", ")}초 전` : ""}`),
    "외부 앱 클릭 위치·버튼명·선택 텍스트는 수집하지 않았습니다. 화면 변화나 선택 영역을 실제 클릭으로 단정하지 마세요.",
  ].filter(Boolean).join("\n");
}
