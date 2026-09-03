import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
const attempts = new Map<string, number[]>();
const MAX_IMAGE_CHARS = 1_600_000;
const MAX_TOTAL_CHARS = 7_500_000;

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allow(ip)) return NextResponse.json({ error: "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "서버에 OPENAI_API_KEY가 설정되지 않았습니다." }, { status: 503 });
  try {
    const body: unknown = await request.json();
    if (!isPayload(body)) return NextResponse.json({ error: "전송할 화면 프레임이 올바르지 않습니다." }, { status: 400 });
    const total = body.frames.reduce((sum, frame) => sum + frame.length, 0);
    if (body.frames.length > 6 || total > MAX_TOTAL_CHARS || body.frames.some((frame) => frame.length > MAX_IMAGE_CHARS)) {
      return NextResponse.json({ error: "프레임 용량이 너무 큽니다." }, { status: 413 });
    }
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
      store: false,
      max_output_tokens: 700,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: body.mode === "replay" ? "시간순으로 캡처된 화면입니다. 방금 어떤 변화가 있었는지, 문제가 보이면 가능한 원인과 바로 할 다음 행동을 한국어로 간결하게 설명하세요." : "현재 화면입니다. 무엇이 보이는지, 문제가 있다면 가능한 원인과 바로 할 다음 행동을 한국어로 간결하게 설명하세요." },
          ...body.frames.map((imageUrl) => ({ type: "input_image" as const, image_url: imageUrl, detail: "high" as const })),
        ],
      }],
    });
    return NextResponse.json({ analysis: response.output_text || "화면을 분석했지만 설명을 만들지 못했습니다." });
  } catch (error) {
    console.error("analysis_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "AI 분석에 실패했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
}

function isPayload(value: unknown): value is { mode: "current" | "replay"; frames: string[] } {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return (body.mode === "current" || body.mode === "replay") && Array.isArray(body.frames) && body.frames.length > 0 && body.frames.every((frame) => typeof frame === "string" && /^data:image\/(jpeg|png);base64,/.test(frame));
}

function allow(ip: string) {
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= 5) return false;
  recent.push(now);
  attempts.set(ip, recent);
  return true;
}
