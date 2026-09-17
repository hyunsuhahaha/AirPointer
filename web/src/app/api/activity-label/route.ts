import OpenAI from "openai";
import { NextResponse } from "next/server";
import { ACTIVITY_CATEGORIES, isActivityRequest } from "@/lib/day-log";
import type { ActivityResult } from "@/lib/day-log";

// Summarizes one stretch of the day timeline from the frames collected while
// the screen changed: the main work, plus what interrupted it. Nothing is
// stored (store: false).
export const runtime = "nodejs";
const attempts = new Map<string, number[]>();
const MAX_REQUESTS_PER_MINUTE = 6;

const INSTRUCTIONS = `당신은 사용자의 하루 작업 기록을 만드는 도우미입니다. 한 구간 동안 화면이 바뀔 때마다 찍은 장면들을 시간순으로 받습니다. 사람은 창을 여러 개 띄워 두고 메신저·뉴스 등을 오가며 일한다는 점을 전제로 판단하세요.
- 먼저 장면 수와 시각을 보고 가장 오래 머문 일 하나를 "주로 한 일"로 고르세요. 나머지는 side입니다.
- label: 주로 한 일 하나만 12~24자 안팎으로. side에 넣은 일을 label에 섞거나 "·"로 이어 붙이지 마세요. 화면에 보이는 프로젝트명·파일명·문서 제목·영상 주제 같은 구체적 단서를 넣으세요. 예: "whatwas 타임라인 UI 수정", "유튜브 시청 · React 강의", "분기 보고서 작성".
- category, app: 주로 한 일의 분류와 앱·사이트 이름. 코드를 읽거나 고치는 화면(GitHub 코드 보기 포함)은 dev입니다.
- side: 주로 한 일과 별개로 잠깐 끼어든 일. 예: "카카오톡 업무 연락", "뉴스 보기". 장면 수와 시각으로 대략의 분을 추정하세요. 같은 일의 다른 창(예: 코드와 그 결과 브라우저)은 side가 아니라 주로 한 일에 포함하세요. 없으면 빈 배열.
- 직전 구간 이름과 같은 일이면 그 이름을 글자 그대로 다시 쓰세요.
- 화면에 없는 내용을 지어내지 마세요. 비밀번호·메시지 본문·계좌번호 같은 민감한 내용은 옮기지 마세요. 메신저는 "카카오톡 대화"처럼 앱과 성격만 적으세요.`;

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allow(ip)) return NextResponse.json({ error: "요청이 너무 잦습니다." }, { status: 429 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "서버에 OPENAI_API_KEY가 설정되지 않았습니다." }, { status: 503 });
  try {
    const body: unknown = await request.json();
    if (!isActivityRequest(body)) return NextResponse.json({ error: "화면 장면이 올바르지 않습니다." }, { status: 400 });
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: process.env.OPENAI_ACTIVITY_MODEL || process.env.OPENAI_MODEL || "gpt-5.4-mini",
      instructions: INSTRUCTIONS,
      store: false,
      max_output_tokens: 500,
      text: { format: {
        type: "json_schema",
        name: "activity_record",
        strict: true,
        schema: {
          type: "object",
          properties: {
            category: { type: "string", enum: [...ACTIVITY_CATEGORIES] },
            label: { type: "string" },
            app: { type: "string" },
            side: { type: "array", maxItems: 4, items: {
              type: "object",
              properties: { label: { type: "string" }, minutes: { type: "integer", minimum: 1 } },
              required: ["label", "minutes"],
              additionalProperties: false,
            } },
          },
          required: ["category", "label", "app", "side"],
          additionalProperties: false,
        },
      } },
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: [
            `구간 길이: ${body.minutes}분, 장면 ${body.frames.length}장.`,
            body.previous.length ? `직전 구간 이름: ${body.previous.join(" / ")}` : "오늘 첫 구간입니다.",
          ].join("\n") },
          ...body.frames.flatMap((frame) => [
            { type: "input_text" as const, text: `${frame.time} 장면` },
            { type: "input_image" as const, image_url: frame.image, detail: "high" as const },
          ]),
        ],
      }],
    });
    const parsed = JSON.parse(response.output_text || "{}") as Partial<ActivityResult>;
    const result: ActivityResult = {
      category: ACTIVITY_CATEGORIES.find((item) => item === parsed.category) ?? "other",
      label: (parsed.label ?? "").trim().slice(0, 40) || "알 수 없는 활동",
      app: (parsed.app ?? "").trim().slice(0, 30),
      side: (parsed.side ?? []).slice(0, 4).map((item) => ({ label: item.label.trim().slice(0, 30), minutes: Math.min(body.minutes, Math.max(1, Math.round(item.minutes))) })).filter((item) => item.label),
    };
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "활동을 정리하지 못했습니다." }, { status: 502 });
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
