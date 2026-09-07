import OpenAI from "openai";
import { NextResponse } from "next/server";
import { formatCaptureMetadata, isAnalysisPayload } from "@/lib/analysis-payload";

export const runtime = "nodejs";
const attempts = new Map<string, number[]>();
const MAX_IMAGE_CHARS = 1_600_000;
const MAX_TOTAL_CHARS = 7_500_000;
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
    if (body.frames.length > 6 || total > MAX_TOTAL_CHARS || body.frames.some((frame) => frame.length > MAX_IMAGE_CHARS)) {
      return NextResponse.json({ error: "프레임 용량이 너무 큽니다." }, { status: 413 });
    }
    const question = body.question?.trim().slice(0, MAX_QUESTION_CHARS);
    const baseInstruction = body.mode === "text" ? "새 화면은 첨부되지 않았습니다. 이전 대화 텍스트를 바탕으로 후속 질문에 한국어로 간결하게 답하세요. 현재 화면이나 이전 이미지를 직접 보고 있다고 말하지 마세요." : body.mode === "replay" ? "시간순으로 캡처된 화면입니다. 방금 어떤 변화가 있었는지, 문제가 보이면 가능한 원인과 바로 할 다음 행동을 한국어로 간결하게 설명하세요." : "현재 화면입니다. 무엇이 보이는지, 문제가 있다면 가능한 원인과 바로 할 다음 행동을 한국어로 간결하게 설명하세요.";
    // The question (if any) is appended to baseInstruction below, not
    // substituted for it -- the base instruction still anchors the model on
    // "describe what happened" even when the user's own question is
    // narrower (e.g. "이 에러 뭐야?"), so a vague question doesn't lose the
    // context a blank submission would have gotten.
    //
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
      captureContext,
      historyLines.length ? `이전 대화:\n${historyLines.join("\n")}` : "",
      question ? `${baseInstruction}\n\n사용자 질문: ${question}` : baseInstruction,
    ].filter(Boolean).join("\n\n");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
      store: false,
      max_output_tokens: 700,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: instruction },
          ...body.frames.map((imageUrl) => ({ type: "input_image" as const, image_url: imageUrl, detail: "high" as const })),
        ],
      }],
    });
    return NextResponse.json({ captureContext, analysis: response.output_text || "화면을 분석했지만 설명을 만들지 못했습니다." });
  } catch (error) {
    console.error("analysis_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "AI 분석에 실패했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
}

function allow(ip: string) {
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= MAX_REQUESTS_PER_MINUTE) return false;
  recent.push(now);
  attempts.set(ip, recent);
  return true;
}
