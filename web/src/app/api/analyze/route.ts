import OpenAI from "openai";
import { NextResponse } from "next/server";
import { ANALYSIS_RESPONSE_INSTRUCTIONS, analysisTaskText, formatCaptureMetadata, isAnalysisPayload, needsTransientReplaySearch, parseAnalysisResult } from "@/lib/analysis-payload";
import { replayExplorationRequestsFrom } from "@/lib/replay-frame-request";

export const runtime = "nodejs";
const attempts = new Map<string, number[]>();
const MAX_IMAGE_CHARS = 1_600_000;
const MAX_TOTAL_CHARS = 30_000_000;
const MAX_FRAMES = 24;
// A user question riding along a capture (e.g. from the PiP window's own
// prompt box) -- generous enough for a real question, capped so this can't
// become a way to pad the request past what the frames themselves cost.
const MAX_QUESTION_CHARS = 500;
// The PiP conversation window (see replay-workspace.tsx's openCapturePip)
// resends the whole thread as plain text on every follow-up turn -- there's
// no server-side thread/session here (store:false is deliberate, so nothing
// persists between requests). Capped two ways so a long-running chat can't
// turn into an unbounded per-request cost: only the last N turns are
// replayed...
const MAX_HISTORY_TURNS = 8;
// ...and the replayed text itself is capped separately from the image
// budget above, since history is pure text and shouldn't compete with how
// many turns fit against how much a single long answer costs.
const MAX_HISTORY_CHARS = 6_000;
// Per-IP request budget raised from the original 5/min: a real back-and-
// forth conversation (see the PiP conversation window) naturally sends one
// request per turn, and 5 was tuned for occasional one-shot checks, not an
// active chat. Still bounded, not removed -- this is a public page, so
// unlimited requests against a paid API key isn't an option.
const MAX_REQUESTS_PER_MINUTE = 20;

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allow(ip)) return NextResponse.json({ error: "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "서버에 OPENAI_API_KEY가 설정되지 않았습니다." }, { status: 503 });
  try {
    const body: unknown = await request.json();
    if (!isAnalysisPayload(body)) return NextResponse.json({ error: "화면 또는 후속 질문이 올바르지 않습니다." }, { status: 400 });
    const total = body.frames.reduce((sum, frame) => sum + frame.length, 0);
    if (body.frames.length > MAX_FRAMES || total > MAX_TOTAL_CHARS || body.frames.some((frame) => frame.length > MAX_IMAGE_CHARS)) {
      return NextResponse.json({ error: "프레임 용량이 너무 큽니다." }, { status: 413 });
    }
    const question = body.question?.trim().slice(0, MAX_QUESTION_CHARS);
    const queried = body.metadata?.images.some((image) => image.kind === "queried-frame" || image.kind === "queried-crop");
    // History is folded into that same single user turn's text as a
    // labeled transcript, not replayed as separate role-tagged `input`
    // items -- the SDK's types for a manually-reconstructed assistant turn
    // want the FULL ResponseOutputMessage shape (id/status/annotations, the exact fields
    // a real API response would have set), not a plain {role, content}
    // object, and `previous_response_id` (the API's own thread mechanism)
    // needs store:true, which this route deliberately doesn't use. A plain
    // text transcript inside one user turn sidesteps both and reads just as
    // well to the model -- it's still following a "사용자: ... / AI: ..."
    // conversation, just not structurally split into separate turns.
    let historyBudget = MAX_HISTORY_CHARS;
    const historyLines = (body.history ?? []).slice(-MAX_HISTORY_TURNS).flatMap((turn) => {
      if (historyBudget <= 0) return [];
      const text = turn.text.slice(0, historyBudget);
      historyBudget -= text.length;
      return [`${turn.role === "user" ? "사용자" : "AI"}: ${text}`];
    });
    const captureContext = formatCaptureMetadata(body.metadata);
    const instruction = [
      analysisTaskText(body.mode, question, queried, body.metadata?.requestedSeconds, body.exploration),
      historyLines.length ? `이전 대화:\n${historyLines.join("\n")}` : "",
      captureContext,
      question ? "최종 응답은 위 사용자 질문에 대한 답만 작성하세요." : "",
    ].filter(Boolean).join("\n\n");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const remainingFrames = body.exploration ? body.exploration.frameBudget - body.exploration.usedFrames : 0;
    const canQueryReplay = body.mode === "replay" && Boolean(body.metadata) && Boolean(body.exploration)
      && remainingFrames > 0 && body.exploration!.round < body.exploration!.maxRounds;
    // Product behavior, not a demo shortcut: when a real user asks about a
    // fleeting event, representative before/after frames are not sufficient
    // evidence. The model still chooses the timestamps; this only guarantees
    // that the local replay is consulted once before it answers.
    const needsTransientSearch = canQueryReplay && needsTransientReplaySearch(question, body.exploration!.round);
    const response = await client.responses.create({
      model: body.model || process.env.OPENAI_MODEL || "gpt-5.4-mini",
      instructions: ANALYSIS_RESPONSE_INSTRUCTIONS,
      store: false,
      max_output_tokens: 700,
      text: { format: {
        type: "json_schema",
        name: "screen_analysis_with_evidence",
        strict: true,
        schema: {
          type: "object",
          properties: {
            answer: { type: "string", description: "사용자 질문에 대한 직접적이고 간결한 한국어 답변" },
            evidence: { type: "array", maxItems: 12, description: "답을 실제로 뒷받침하는 첨부 화면 근거. 새 화면이 없는 후속 질문이면 빈 배열", items: {
              type: "object",
              properties: {
                frame_number: { type: "integer", minimum: 1, maximum: 24, description: "입력에 첨부된 이미지의 1부터 시작하는 번호" },
                claim: { type: "string", description: "이 프레임에서 직접 확인되는 근거" },
              },
              required: ["frame_number", "claim"],
              additionalProperties: false,
            } },
          },
          required: ["answer", "evidence"],
          additionalProperties: false,
        },
      } },
      ...(canQueryReplay ? { tools: [
        {
          type: "function" as const,
          name: "request_replay_frames",
          description: `브라우저에만 보존된 최근 ${body.metadata!.requestedSeconds}초 영상에서 추가 시점을 조회합니다. 기준 시각 이전을 음수 초로 지정하세요. 핵심 전환 구간이 넓으면 그 구간 안을 여러 점으로 촘촘히 좁히고, 다음 응답에서 필요하면 다시 호출할 수 있습니다. 이번 호출은 남은 전체 예산 ${remainingFrames}장 안에서 사용하세요.`,
          strict: true,
          parameters: {
            type: "object",
            properties: { offsets_seconds: { type: "array", minItems: 1, maxItems: remainingFrames, items: { type: "number" } } },
            required: ["offsets_seconds"],
            additionalProperties: false,
          },
        },
        {
          type: "function" as const,
          name: "request_replay_crop",
          description: "첨부 프레임의 작은 오류 문구나 UI 영역을 원본 해상도로 확대 조회합니다. 좌표는 화면 전체 대비 0~1이며 꼭 필요한 영역만 지정하세요.",
          strict: true,
          parameters: {
            type: "object",
            properties: {
              frame_number: { type: "integer", minimum: 1, maximum: body.frames.length },
              left: { type: "number", minimum: 0, maximum: 1 },
              top: { type: "number", minimum: 0, maximum: 1 },
              right: { type: "number", minimum: 0, maximum: 1 },
              bottom: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["frame_number", "left", "top", "right", "bottom"],
            additionalProperties: false,
          },
        },
      ], tool_choice: needsTransientSearch
        ? { type: "function" as const, name: "request_replay_frames" }
        : "auto" as const } : {}),
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: instruction },
          ...body.frames.flatMap((imageUrl, index) => [
            { type: "input_text" as const, text: frameLabel(body.metadata, index) },
            { type: "input_image" as const, image_url: imageUrl, detail: "high" as const },
          ]),
        ],
      }],
    });
    const explorationRequests = canQueryReplay ? replayExplorationRequestsFrom(response.output, body.metadata!.requestedSeconds, body.frames.length, remainingFrames) : [];
    if (explorationRequests.length) return NextResponse.json({ captureContext, explorationRequests });
    const result = parseAnalysisResult(response.output_text || "화면을 분석했지만 설명을 만들지 못했습니다.", body.frames.length);
    return NextResponse.json({ captureContext, ...result });
  } catch (error) {
    console.error("analysis_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "AI 분석에 실패했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
}

function frameLabel(metadata: Parameters<typeof formatCaptureMetadata>[0], index: number) {
  const image = metadata?.images[index];
  if (!image) return `이미지 ${index + 1}`;
  const offsets = image.offsetsSeconds.length ? ` · 기준 시각보다 ${image.offsetsSeconds.map((value) => value.toFixed(2)).join(", ")}초 전` : "";
  return `이미지 ${index + 1} · ${image.kind}${offsets}`;
}

function allow(ip: string) {
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= MAX_REQUESTS_PER_MINUTE) return false;
  recent.push(now);
  attempts.set(ip, recent);
  return true;
}
