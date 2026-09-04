import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { CodexAppServer, CodexBusyError } from "@/lib/codex-app-server";
import { hasCodexDesktopBridge, listDesktopThreads, sendDesktopMessage } from "@/lib/codex-desktop-bridge";
import { loadPromptTemplate } from "@/lib/prompt-template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_CHARS = 1_600_000;
const MAX_TOTAL_CHARS = 7_500_000;
const MAX_CAPSULE_BYTES = 48 * 1024 * 1024;
const MAX_PROMPT_CHARS = 2_000;

type CaptureKind = "screenshot" | "region" | "replay";

type PreparedCapture = {
  threadId: string;
  mode: "current" | "replay";
  kind: CaptureKind;
  seconds: number;
  userPrompt: string;
  imagePaths: string[];
  capsule?: { manifestPath: string; segmentCount: number; triggeredAt: number };
};

export async function GET() {
  const desktop = hasCodexDesktopBridge();
  if (desktop) {
    try {
      return NextResponse.json({ available: true, transport: "desktop", threads: await listDesktopThreads() });
    } catch (error) {
      return NextResponse.json({ available: false, threads: [], error: messageOf(error) }, { status: 503 });
    }
  }
  const client = new CodexAppServer();
  try {
    const threads = await client.listThreads();
    return NextResponse.json({ available: true, transport: "app-server", threads });
  } catch (error) {
    return NextResponse.json({ available: false, threads: [], error: messageOf(error) }, { status: 503 });
  } finally {
    client.close();
  }
}

export async function POST(request: Request) {
  const captureDir = join(tmpdir(), "airpointer-web", randomUUID());
  try {
    await mkdir(captureDir, { recursive: true });
    const prepared = request.headers.get("content-type")?.includes("multipart/form-data")
      ? await prepareCapsule(request, captureDir)
      : await prepareImageCapture(request, captureDir);
    const prompt = await makePrompt(prepared);
    let result: { turnId?: string };
    if (hasCodexDesktopBridge()) {
      const pathList = prepared.imagePaths.map((path, index) => `${index + 1}. ${path}`).join("\n");
      await sendDesktopMessage(prepared.threadId, `${prompt}\n\n아래 로컬 이미지 파일을 순서대로 view_image로 여세요.\n${pathList}`);
      result = {};
    } else {
      result = await new CodexAppServer().send(prepared.threadId, prompt, prepared.imagePaths);
    }
    scheduleCleanup(captureDir, prepared.capsule ? 60 : 15);
    return NextResponse.json({ delivered: true, turnId: result.turnId || "queued-by-codex-app", frameCount: prepared.imagePaths.length, capsule: prepared.capsule ? { segmentCount: prepared.capsule.segmentCount, expiresInMinutes: 60 } : undefined });
  } catch (error) {
    await rm(captureDir, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof CodexBusyError) return NextResponse.json({ queued: true, error: error.message }, { status: 409 });
    return NextResponse.json({ error: messageOf(error) }, { status: error instanceof PayloadError ? error.status : 500 });
  }
}

async function prepareImageCapture(request: Request, captureDir: string): Promise<PreparedCapture> {
  const body: unknown = await request.json();
  if (!isPayload(body)) throw new PayloadError("Codex 작업 또는 화면 프레임이 올바르지 않습니다.", 400);
  const total = body.frames.reduce((sum, frame) => sum + frame.length, 0);
  if (body.frames.length > 6 || total > MAX_TOTAL_CHARS || body.frames.some((frame) => frame.length > MAX_IMAGE_CHARS)) throw new PayloadError("프레임 용량이 너무 큽니다.", 413);
  const imagePaths = await Promise.all(body.frames.map(async (frame, index) => {
    const parsed = parseDataUrl(frame);
    const path = join(captureDir, `frame-${String(index + 1).padStart(2, "0")}.${parsed.extension}`);
    await writeFile(path, parsed.data);
    return path;
  }));
  return { threadId: body.threadId, mode: body.mode, kind: body.kind || "screenshot", seconds: body.seconds, userPrompt: body.userPrompt.trim(), imagePaths };
}

async function prepareCapsule(request: Request, captureDir: string): Promise<PreparedCapture> {
  const form = await request.formData();
  const rawMetadata = form.get("metadata");
  if (typeof rawMetadata !== "string") throw new PayloadError("Replay Capsule 메타데이터가 없습니다.", 400);
  let metadata: CapsuleMetadata;
  try {
    const parsed: unknown = JSON.parse(rawMetadata);
    if (!isCapsuleMetadata(parsed)) throw new Error();
    metadata = parsed;
  } catch {
    throw new PayloadError("Replay Capsule 메타데이터가 올바르지 않습니다.", 400);
  }
  const overviewFiles = form.getAll("overview").filter((entry): entry is File => typeof entry !== "string");
  const segmentFiles = form.getAll("segment").filter((entry): entry is File => typeof entry !== "string");
  if (!overviewFiles.length || overviewFiles.length > 6 || !segmentFiles.length || segmentFiles.length > 70 || segmentFiles.length !== metadata.segments.length) throw new PayloadError("Replay Capsule 파일 구성이 올바르지 않습니다.", 400);
  const totalBytes = [...overviewFiles, ...segmentFiles].reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_CAPSULE_BYTES) throw new PayloadError("Replay Capsule 용량이 너무 큽니다.", 413);
  if (overviewFiles.some((file) => !["image/jpeg", "image/png"].includes(file.type)) || segmentFiles.some((file) => !file.type.startsWith("video/webm"))) throw new PayloadError("Replay Capsule 파일 형식을 지원하지 않습니다.", 400);

  const overviewDir = join(captureDir, "overview");
  const segmentDir = join(captureDir, "segments");
  await Promise.all([mkdir(overviewDir), mkdir(segmentDir)]);
  const imagePaths = await Promise.all(overviewFiles.map(async (file, index) => {
    const path = join(overviewDir, `overview-${String(index + 1).padStart(2, "0")}.jpg`);
    await writeFile(path, Buffer.from(await file.arrayBuffer()));
    return path;
  }));
  const segments = await Promise.all(segmentFiles.map(async (file, index) => {
    const path = join(segmentDir, `segment-${String(index + 1).padStart(3, "0")}.webm`);
    await writeFile(path, Buffer.from(await file.arrayBuffer()));
    return { ...metadata.segments[index], path };
  }));
  const manifestPath = join(captureDir, "replay-manifest.json");
  const helperPath = join(process.cwd(), "scripts", "replay-frame.mjs");
  await writeFile(manifestPath, JSON.stringify({ version: 1, createdAt: Date.now(), startedAt: metadata.startedAt, triggeredAt: metadata.triggeredAt, seconds: metadata.seconds, overviewPaths: imagePaths, segments, frameQuery: { helperPath, commandExample: `node "${helperPath}" "${manifestPath}" -0.5`, description: "마지막 숫자는 제스처 기준 상대 초입니다. 음수는 이전 화면이며 여러 값을 한 번에 전달할 수 있습니다." } }, null, 2), "utf8");
  return { threadId: metadata.threadId, mode: "replay", kind: "replay", seconds: metadata.seconds, userPrompt: metadata.userPrompt.trim(), imagePaths, capsule: { manifestPath, segmentCount: segments.length, triggeredAt: metadata.triggeredAt } };
}

// Single source of truth for prompt wording: both the browser (JSON or
// multipart, below) and the AirPointer.exe companion (JSON, via its own
// /api/agent POST) funnel through here. The native app used to compose its
// own Korean context sentence and send that as userPrompt, which this
// function then wrapped in its own template -- producing a nested, doubled
// prompt whenever a capture came from AirPointer instead of the browser.
// AirPointer now sends the raw question (or nothing) plus `kind`, same as
// the browser, so there is exactly one place that decides what Codex sees.
// Everything here except the user's own typed question is editable from the
// browser's prompt-settings dialog (see /api/prompt-settings).
async function makePrompt(capture: PreparedCapture) {
  const template = await loadPromptTemplate();
  const userPrompt = capture.userPrompt || template.defaultRequestByKind[capture.kind];
  if (!capture.capsule) return `${template.wrapperIntro}

맥락: ${template.contextByKind[capture.kind]}

사용자의 요청:
${userPrompt}

${template.wrapperOutro}`;
  const helperPath = join(process.cwd(), "scripts", "replay-frame.mjs");
  return `${template.capsuleIntro.replace("{seconds}", String(capture.seconds))}

사용자의 요청:
${userPrompt}

${template.capsuleInstruction}

Replay Capsule manifest: ${capture.capsule.manifestPath}
원본 구간 수: ${capture.capsule.segmentCount}
조회 명령: node "${helperPath}" "${capture.capsule.manifestPath}" -0.5
여러 시점 조회: node "${helperPath}" "${capture.capsule.manifestPath}" -0.5 -1 -1.5

마지막 숫자는 제스처 완료 시점 기준 상대 초입니다. 예를 들어 -0.5는 0.5초 전입니다. 위 요청에 필요한 장면이 개요에 없다면 인접 시점을 추가 조회한 뒤 답하세요. 캡슐은 60분 후 자동 삭제됩니다.`;
}

type AgentPayload = { threadId: string; mode: "current" | "replay"; kind?: CaptureKind; seconds: number; frames: string[]; userPrompt: string };
type CapsuleMetadata = { threadId: string; mode: "replay"; seconds: number; userPrompt: string; startedAt: number; triggeredAt: number; segments: Array<{ startedAt: number; durationMs: number; mimeType: string }> };

function isPayload(value: unknown): value is AgentPayload {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  // Unlike the capsule path, userPrompt may be empty here: AirPointer's
  // gesture-triggered instant captures (no prompt dialog) send one, and
  // makePrompt() fills in a kind-appropriate default when it's blank.
  return typeof body.threadId === "string" && body.threadId.length > 0 && isOptionalPrompt(body.userPrompt)
    && (body.mode === "current" || body.mode === "replay")
    && (body.kind === undefined || ["screenshot", "region", "replay"].includes(body.kind as string))
    && typeof body.seconds === "number" && Number.isFinite(body.seconds) && Array.isArray(body.frames) && body.frames.length > 0 && body.frames.every((frame) => typeof frame === "string" && /^data:image\/(jpeg|png);base64,/.test(frame));
}

function isCapsuleMetadata(value: unknown): value is CapsuleMetadata {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.threadId === "string" && item.threadId.length > 0 && item.mode === "replay" && isPrompt(item.userPrompt) && typeof item.seconds === "number" && Number.isFinite(item.seconds) && item.seconds > 0 && item.seconds <= 60 && typeof item.startedAt === "number" && Number.isFinite(item.startedAt) && typeof item.triggeredAt === "number" && Number.isFinite(item.triggeredAt) && Array.isArray(item.segments) && item.segments.every((segment) => {
    if (!segment || typeof segment !== "object") return false;
    const entry = segment as Record<string, unknown>;
    return typeof entry.startedAt === "number" && Number.isFinite(entry.startedAt) && typeof entry.durationMs === "number" && Number.isFinite(entry.durationMs) && entry.durationMs > 0 && entry.durationMs < 5_000 && typeof entry.mimeType === "string" && entry.mimeType.startsWith("video/webm");
  });
}

function isPrompt(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_PROMPT_CHARS;
}

function isOptionalPrompt(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_PROMPT_CHARS;
}

function parseDataUrl(value: string) {
  const match = /^data:image\/(jpeg|png);base64,(.+)$/.exec(value);
  if (!match) throw new Error("지원하지 않는 화면 이미지 형식입니다.");
  return { extension: match[1] === "jpeg" ? "jpg" : "png", data: Buffer.from(match[2], "base64") };
}

function scheduleCleanup(path: string, minutes: number) {
  const timer = setTimeout(() => void rm(path, { recursive: true, force: true }), minutes * 60_000);
  timer.unref();
}

function messageOf(error: unknown) { return error instanceof Error ? error.message : "Codex Agent 연결에 실패했습니다."; }
class PayloadError extends Error { constructor(message: string, readonly status: number) { super(message); } }
