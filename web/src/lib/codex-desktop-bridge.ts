import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import type { AgentThread } from "@/lib/codex-app-server";

type JsonObject = Record<string, unknown>;
type ToolResult = { success?: boolean; contentItems?: Array<{ type?: string; text?: string }> };

const MAX_FRAME_BYTES = 16 * 1024 * 1024;

export function hasCodexDesktopBridge() {
  return Boolean(process.env.CODEX_APP_TOOLS_PIPE_PATH?.trim() && process.env.CODEX_THREAD_ID?.trim());
}

export async function listDesktopThreads(): Promise<AgentThread[]> {
  const result = await callAppTool("list_threads", { limit: 50 });
  const payload = parseToolJson(result);
  const threads = Array.isArray(payload.threads) ? payload.threads : [];
  return threads.flatMap((item) => {
    if (!isObject(item) || item.kind !== "codex" || item.hostId !== "local" || typeof item.id !== "string") return [];
    return [{
      id: item.id,
      title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : item.id,
      status: isThreadStatus(item.status) ? item.status : "unknown",
      cwd: typeof item.cwd === "string" ? item.cwd : "",
      updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : 0,
      hostId: "local",
    }];
  });
}

export async function sendDesktopMessage(threadId: string, prompt: string) {
  const result = await callAppTool("send_message_to_thread", { threadId, hostId: "local", prompt });
  if (result.success === false) throw new Error(toolText(result) || "Codex 앱이 Agent 메시지를 거부했습니다.");
  return { message: toolText(result) };
}

async function callAppTool(tool: string, args: JsonObject): Promise<ToolResult> {
  const pipePath = process.env.CODEX_APP_TOOLS_PIPE_PATH?.trim();
  const callerThreadId = process.env.CODEX_THREAD_ID?.trim();
  if (!pipePath || !callerThreadId) throw new Error("Codex 데스크톱 앱 연결 정보를 찾지 못했습니다.");
  const result = await pipeRequest(pipePath, "tools/call", {
    namespace: "codex_app",
    tool,
    arguments: args,
    callId: `airpointer-${randomUUID()}`,
    threadId: callerThreadId,
    turnId: `airpointer-${randomUUID()}`,
  });
  if (!isObject(result)) throw new Error("Codex 앱 도구가 올바르지 않은 응답을 반환했습니다.");
  return result as ToolResult;
}

function pipeRequest(pipePath: string, method: string, params: JsonObject): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(pipePath);
    let received = Buffer.alloc(0);
    const timer = setTimeout(() => finish(new Error("Codex 데스크톱 앱 응답 시간이 초과되었습니다.")), 20_000);

    const finish = (error?: Error, value?: unknown) => {
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };

    socket.once("error", (error) => finish(error));
    socket.once("connect", () => {
      const payload = Buffer.from(JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }), "utf8");
      const header = Buffer.allocUnsafe(4);
      header.writeUInt32LE(payload.length, 0);
      socket.write(Buffer.concat([header, payload]));
    });
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      if (received.length < 4) return;
      const length = received.readUInt32LE(0);
      if (length > MAX_FRAME_BYTES) return finish(new Error("Codex 앱 응답이 허용 크기를 초과했습니다."));
      if (received.length < length + 4) return;
      try {
        const response = JSON.parse(received.subarray(4, length + 4).toString("utf8")) as { result?: unknown; error?: { message?: string } };
        if (response.error) finish(new Error(response.error.message || "Codex 앱 도구 호출에 실패했습니다."));
        else finish(undefined, response.result);
      } catch {
        finish(new Error("Codex 앱 응답을 해석하지 못했습니다."));
      }
    });
  });
}

function parseToolJson(result: ToolResult): JsonObject {
  const text = toolText(result);
  if (!text) throw new Error("Codex 앱이 작업 목록을 반환하지 않았습니다.");
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isObject(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error("Codex 앱 작업 목록을 해석하지 못했습니다.");
  }
}

function toolText(result: ToolResult) {
  return (result.contentItems || []).filter((item) => item.type === "inputText" && typeof item.text === "string").map((item) => item.text).join("\n");
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isThreadStatus(value: unknown): value is AgentThread["status"] {
  return typeof value === "string" && ["active", "idle", "notLoaded", "systemError", "unknown"].includes(value);
}
