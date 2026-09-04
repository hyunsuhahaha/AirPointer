import { NextResponse } from "next/server";
import { DEFAULT_PROMPT_TEMPLATE, loadPromptTemplate, savePromptTemplate, type PromptTemplate } from "@/lib/prompt-template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FIELD_CHARS = 1_000;

export async function GET() {
  const template = await loadPromptTemplate();
  return NextResponse.json({ template, defaults: DEFAULT_PROMPT_TEMPLATE });
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!isTemplate(body)) return NextResponse.json({ error: "프롬프트 설정 형식이 올바르지 않습니다." }, { status: 400 });
  await savePromptTemplate(body);
  return NextResponse.json({ saved: true, template: body });
}

export async function DELETE() {
  await savePromptTemplate(DEFAULT_PROMPT_TEMPLATE);
  return NextResponse.json({ saved: true, template: DEFAULT_PROMPT_TEMPLATE });
}

function isTemplate(value: unknown): value is PromptTemplate {
  if (!isObject(value)) return false;
  return isField(value.wrapperIntro) && isField(value.wrapperOutro)
    && isKindMap(value.contextByKind) && isKindMap(value.defaultRequestByKind)
    && isField(value.capsuleIntro) && isField(value.capsuleInstruction);
}

function isKindMap(value: unknown): value is Record<"screenshot" | "region" | "replay", string> {
  return isObject(value) && (["screenshot", "region", "replay"] as const).every((key) => isField(value[key]));
}

function isField(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_FIELD_CHARS;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
