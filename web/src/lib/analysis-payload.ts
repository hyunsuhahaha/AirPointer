export type AnalysisPayload = {
  mode: "current" | "replay" | "text";
  frames: string[];
  question?: string;
  history?: { role: "user" | "assistant"; text: string }[];
};

export function isAnalysisPayload(value: unknown): value is AnalysisPayload {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.frames) || !body.frames.every((frame) => typeof frame === "string" && /^data:image\/(jpeg|png);base64,/.test(frame))) return false;
  if (body.question !== undefined && typeof body.question !== "string") return false;
  if (body.history !== undefined && (!Array.isArray(body.history) || !body.history.every((turn) =>
    turn && typeof turn === "object" && (turn.role === "user" || turn.role === "assistant") && typeof turn.text === "string"))) return false;
  return body.mode === "text"
    ? body.frames.length === 0 && typeof body.question === "string" && Boolean(body.question.trim()) && Array.isArray(body.history) && body.history.some((turn) => turn.role === "assistant" && turn.text.trim())
    : (body.mode === "current" || body.mode === "replay") && body.frames.length > 0;
}
