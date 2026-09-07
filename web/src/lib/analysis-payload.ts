export type AnalysisPayload = {
  mode: "current" | "replay" | "text";
  model?: AnalysisModelId;
  frames: string[];
  metadata?: CaptureMetadata;
  exploration?: ReplayExploration;
  question?: string;
  history?: { role: "user" | "assistant"; text: string }[];
};

export function isAnalysisPayload(value: unknown): value is AnalysisPayload {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.frames) || !body.frames.every((frame) => typeof frame === "string" && /^data:image\/(jpeg|png);base64,/.test(frame))) return false;
  if (body.model !== undefined && !ANALYSIS_MODELS.some((model) => model.id === body.model)) return false;
  if (body.metadata !== undefined && !isCaptureMetadata(body.metadata, body.frames.length)) return false;
  if (body.exploration !== undefined && (body.mode !== "replay" || !isReplayExploration(body.exploration, body.frames.length))) return false;
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
  images: { kind: "screen" | "contact-sheet" | "selection" | "change-crop" | "replay-frame" | "bookmarked-frame" | "queried-frame" | "queried-crop"; offsetsSeconds: number[] }[];
};

export type ReplayExploration = { round: number; maxRounds: number; frameBudget: number; usedFrames: number };

export function needsTransientReplaySearch(question: string | undefined, round: number): boolean {
  return round === 0 && Boolean(question) && /(방금|잠깐|순간|사라|놓친|끊|실패|오류|just now|briefly|moment|disappear|missed|failed|error)/i.test(question!);
}

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
    && Array.isArray(m.images) && m.images.length === count && count <= 24
    && m.images.every(i => i && ["screen", "contact-sheet", "selection", "change-crop", "replay-frame", "bookmarked-frame", "queried-frame", "queried-crop"].includes(i.kind) && Array.isArray(i.offsetsSeconds) && i.offsetsSeconds.length <= 10 && i.offsetsSeconds.every(n => finite(n, 3600)));
}

function isReplayExploration(value: unknown, frameCount: number): value is ReplayExploration {
  if (!value || typeof value !== "object") return false;
  const e = value as ReplayExploration;
  return Number.isInteger(e.round) && e.round >= 0 && e.round <= 8
    && Number.isInteger(e.maxRounds) && e.maxRounds >= 1 && e.maxRounds <= 8 && e.round <= e.maxRounds
    && Number.isInteger(e.frameBudget) && e.frameBudget >= 6 && e.frameBudget <= 24
    && Number.isInteger(e.usedFrames) && e.usedFrames === frameCount && e.usedFrames <= e.frameBudget;
}

// This exact text is included in the model input and returned as a delivery receipt.
export function formatCaptureMetadata(m?: CaptureMetadata): string {
  if (!m) return "";
  const kinds = { screen: "현재 화면", "contact-sheet": "시간순 모음 (왼쪽→오른쪽, 위→아래)", selection: "선택 영역", "change-crop": "변화 확대 (시각 미확인)",
    "replay-frame": "변화 감지 알고리즘이 고른 대표 프레임", "bookmarked-frame": "사용자가 북마크한 시점의 추가 프레임", "queried-frame": "AI 요청으로 로컬 영상에서 추가 조회한 프레임", "queried-crop": "AI 요청으로 특정 화면을 고해상도 확대한 프레임" };
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

export const ANALYSIS_MODELS = [
  { id: "gpt-5.4-nano", label: "5.4 nano · 빠름" },
  { id: "gpt-5.4-mini", label: "5.4 mini · 기본" },
  { id: "gpt-5.6-terra", label: "5.6 Terra · 균형" },
  { id: "gpt-5.6-sol", label: "5.6 Sol · 정밀" },
] as const;
export type AnalysisModelId = typeof ANALYSIS_MODELS[number]["id"];

export const ANALYSIS_RESPONSE_INSTRUCTIONS = "사용자가 질문을 제공한 경우 그 질문이 유일한 응답 과업입니다. 첨부 화면과 리플레이는 질문을 해결하기 위한 관찰 근거일 뿐, 별도로 요약할 대상이 아닙니다. 질문과 무관한 앱 전환, 창 목록, 화면 타임라인을 설명하지 마세요. 결론부터 직접 답하고 필요한 화면 근거만 언급하세요. evidence에는 답을 실제로 뒷받침하는 첨부 이미지 번호와 그 이미지에서 확인되는 사실만 넣으세요.";

export type AnalysisEvidence = { frameIndex: number; claim: string };

export function parseAnalysisResult(raw: string, frameCount: number): { analysis: string; evidence: AnalysisEvidence[] } {
  try {
    const value = JSON.parse(raw) as { answer?: unknown; evidence?: unknown };
    if (typeof value.answer !== "string" || !value.answer.trim() || !Array.isArray(value.evidence)) throw new Error("invalid analysis result");
    const seen = new Set<number>();
    const evidence = value.evidence.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const { frame_number: number, claim } = item as { frame_number?: unknown; claim?: unknown };
      const frameIndex = typeof number === "number" && Number.isInteger(number) ? number - 1 : -1;
      if (frameIndex < 0 || frameIndex >= frameCount || seen.has(frameIndex) || typeof claim !== "string" || !claim.trim()) return [];
      seen.add(frameIndex);
      return [{ frameIndex, claim: claim.trim().slice(0, 240) }];
    });
    return { analysis: value.answer.trim(), evidence };
  } catch {
    return { analysis: raw.trim(), evidence: [] };
  }
}

export function analysisTaskText(mode: "current" | "replay" | "text", question?: string, queried = false, seconds = 0, exploration?: ReplayExploration): string {
  if (mode === "text") return `새 화면은 첨부되지 않았습니다. 이전 대화 텍스트를 바탕으로 다음 후속 질문에 한국어로 간결하게 답하세요. 현재 화면이나 이전 이미지를 직접 보고 있다고 말하지 마세요.\n\n사용자 질문: ${question}`;
  if (question) {
    const evidence = mode === "replay"
      ? `첨부된 최근 ${seconds}초의 ${queried ? "대표 프레임과 추가 탐색 프레임" : "대표 프레임"}은 문제 상황을 파악하고 답의 근거를 확인하는 데만 사용하세요. 화면 변화 자체를 요약하거나 시간순으로 나열하지 마세요. 사용자가 순간적으로 나타난 알림·오류·중단의 정확한 내용을 묻는데 대표 프레임에는 전후 상태만 보인다면 그 상태 문구로 대신 답하지 말고 request_replay_frames로 전환 사이를 촘촘히 조회하세요. 글씨가 작으면 request_replay_crop으로 해당 프레임의 영역을 확대하세요. 오류 문구가 화면 일부에 작게 표시된 프레임은 최종 답변 전에 영역 확대를 우선하세요.${exploration ? ` 현재 ${exploration.usedFrames}/${exploration.frameBudget}장, 적응형 탐색 ${exploration.round}/${exploration.maxRounds}회입니다.` : ""}`
      : "첨부된 현재 화면에서 질문 해결에 필요한 정보만 확인하세요. 화면 전체를 일반적으로 묘사하지 마세요.";
    return `사용자 질문: ${question}\n\n${evidence}\n화면에 근거가 없으면 추측하지 말고 확인할 수 없는 부분을 분명히 밝히세요.`;
  }
  return mode === "replay"
    ? `${queried ? "대표 프레임과 적응형으로 추가 조회한 프레임" : "화면 변화 알고리즘이 고른 대표 프레임"}을 보고 최근 ${seconds}초의 핵심 변화를 한국어로 간결하게 설명하세요. 근거가 부족하면 시간 재탐색 또는 영역 확대를 요청하세요.${exploration ? ` 현재 ${exploration.usedFrames}/${exploration.frameBudget}장, 탐색 ${exploration.round}/${exploration.maxRounds}회입니다.` : ""}`
    : "현재 화면에서 눈에 띄는 문제와 가능한 원인, 바로 할 다음 행동을 한국어로 간결하게 설명하세요.";
}
