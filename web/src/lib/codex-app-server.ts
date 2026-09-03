import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

type JsonObject = Record<string, unknown>;
type RpcResponse = { id?: number; method?: string; params?: JsonObject; result?: JsonObject; error?: { message?: string } };

export type AgentThread = {
  id: string;
  title: string;
  status: "active" | "idle" | "notLoaded" | "systemError" | "unknown";
  cwd: string;
  updatedAt: number;
  hostId?: string;
};

export class CodexBusyError extends Error {
  constructor() {
    super("선택한 Codex 작업이 실행 중입니다.");
    this.name = "CodexBusyError";
  }
}

export class CodexAppServer {
  private process: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<void> | null = null;
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: JsonObject) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout }>();
  private turnText = new Map<string, string[]>();
  private completedTurns = new Map<string, { status: string; text: string }>();
  private turnWaiters = new Map<string, { resolve: (value: { status: string; text: string }) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout }>();
  private stderr = "";

  async listThreads(): Promise<AgentThread[]> {
    const result = await this.request("thread/list", {
      limit: 80,
      sortKey: "updated_at",
      sortDirection: "desc",
      sourceKinds: ["cli", "vscode", "exec", "appServer", "unknown"],
      archived: false,
    });
    const data = Array.isArray(result.data) ? result.data : [];
    return data.flatMap((item) => {
      if (!isObject(item) || typeof item.id !== "string") return [];
      const status = isObject(item.status) && typeof item.status.type === "string" ? item.status.type : "unknown";
      const title = oneLine(
        typeof item.name === "string" && item.name ? item.name
          : typeof item.preview === "string" && item.preview ? item.preview
            : item.id,
      );
      return [{
        id: item.id,
        title,
        status: isThreadStatus(status) ? status : "unknown",
        cwd: typeof item.cwd === "string" ? item.cwd : "",
        updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : 0,
      }];
    });
  }

  async send(threadId: string, prompt: string, imagePaths: string[]): Promise<{ turnId: string }> {
    if (!threadId) throw new Error("전송할 Codex 작업을 선택해 주세요.");
    if (!imagePaths.length) throw new Error("전송할 화면이 없습니다.");

    const read = await this.request("thread/read", { threadId, includeTurns: false });
    const thread = isObject(read.thread) ? read.thread : {};
    const status = isObject(thread.status) && typeof thread.status.type === "string" ? thread.status.type : "unknown";
    if (status === "active") throw new CodexBusyError();

    await this.request("thread/resume", { threadId, excludeTurns: true });
    return this.startTurn(threadId, prompt, imagePaths);
  }

  async sendToLoadedThread(threadId: string, prompt: string, imagePaths: string[]): Promise<{ turnId: string }> {
    if (!threadId || !imagePaths.length) throw new Error("Codex 테스트 입력이 올바르지 않습니다.");
    return this.startTurn(threadId, prompt, imagePaths);
  }

  private async startTurn(threadId: string, prompt: string, imagePaths: string[]): Promise<{ turnId: string }> {
    const result = await this.request("turn/start", {
      threadId,
      turnTrigger: "airpointer_gesture",
      input: [
        { type: "text", text: prompt },
        ...imagePaths.map((path) => ({ type: "localImage", path })),
      ],
    });
    const turn = isObject(result.turn) ? result.turn : {};
    if (typeof turn.id !== "string") throw new Error("Codex가 turn ID를 반환하지 않았습니다.");
    return { turnId: turn.id };
  }

  async startEphemeralThread(cwd: string): Promise<string> {
    const result = await this.request("thread/start", {
      cwd,
      ephemeral: true,
      approvalPolicy: "never",
      sandbox: "read-only",
      serviceName: "airpointer_web_smoke_test",
      developerInstructions: "Inspect attached image inputs carefully, then answer the user's verification request directly and briefly.",
    });
    const thread = isObject(result.thread) ? result.thread : {};
    if (typeof thread.id !== "string") throw new Error("Codex가 임시 thread ID를 반환하지 않았습니다.");
    return thread.id;
  }

  async waitForTurn(_threadId: string, turnId: string, timeoutMs = 120_000): Promise<{ status: string; text: string }> {
    const completed = this.completedTurns.get(turnId);
    if (completed) return completed;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.turnWaiters.delete(turnId);
        reject(new Error("Codex Agent의 테스트 응답을 기다리다 시간 초과되었습니다."));
      }, timeoutMs);
      this.turnWaiters.set(turnId, { resolve, reject, timer });
    });
  }

  close() {
    const child = this.process;
    this.process = null;
    if (child && child.exitCode === null) child.kill();
  }

  private async request(method: string, params: JsonObject): Promise<JsonObject> {
    await this.ensureStarted();
    return this.requestStarted(method, params);
  }

  private async ensureStarted(): Promise<void> {
    if (this.process && this.process.exitCode === null) return;
    if (this.starting) return this.starting;
    this.starting = this.start();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async start(): Promise<void> {
    this.stderr = "";
    const child = spawn(process.env.CODEX_EXECUTABLE || "codex", ["app-server", "--stdio"], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = child;
    createInterface({ input: child.stdout }).on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(-4_000);
    });
    child.on("error", (error) => this.failProcess(error));
    child.on("exit", (code) => this.failProcess(new Error(`Codex App Server가 종료되었습니다 (${code ?? "unknown"}). ${this.stderr}`.trim())));

    try {
      await this.requestStarted("initialize", {
        clientInfo: { name: "airpointer_web", title: "AirPointer Web", version: "0.4.0" },
      });
      this.write({ method: "initialized", params: {} });
    } catch (error) {
      child.kill();
      throw error;
    }
  }

  private requestStarted(method: string, params: JsonObject): Promise<JsonObject> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex App Server가 ${method} 요청에 응답하지 않았습니다.`));
      }, 20_000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ method, id, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private handleLine(line: string) {
    let message: RpcResponse;
    try {
      message = JSON.parse(line) as RpcResponse;
    } catch {
      return;
    }
    if (message.method === "item/completed" && isObject(message.params)) {
      const turnId = message.params.turnId;
      const item = isObject(message.params.item) ? message.params.item : {};
      if (typeof turnId === "string" && item.type === "agentMessage" && typeof item.text === "string") {
        const messages = this.turnText.get(turnId) || [];
        messages.push(item.text);
        this.turnText.set(turnId, messages);
      }
    }
    if (message.method === "turn/completed" && isObject(message.params)) {
      const turn = isObject(message.params.turn) ? message.params.turn : {};
      if (typeof turn.id === "string") {
        const completed = { status: typeof turn.status === "string" ? turn.status : "unknown", text: (this.turnText.get(turn.id) || []).join("\n") };
        this.completedTurns.set(turn.id, completed);
        this.turnText.delete(turn.id);
        const waiter = this.turnWaiters.get(turn.id);
        if (waiter) {
          clearTimeout(waiter.timer);
          this.turnWaiters.delete(turn.id);
          waiter.resolve(completed);
        }
      }
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(`Codex App Server: ${message.error.message || "알 수 없는 오류"}`));
    else pending.resolve(message.result || {});
  }

  private write(message: JsonObject) {
    if (!this.process || this.process.exitCode !== null) throw new Error("Codex App Server가 실행 중이 아닙니다.");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private failProcess(error: Error) {
    const failed = this.process;
    this.process = null;
    if (failed && failed.exitCode === null) failed.kill();
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
    for (const { reject, timer } of this.turnWaiters.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.turnWaiters.clear();
  }
}

let singleton: CodexAppServer | null = null;

export function getCodexAppServer() {
  singleton ??= new CodexAppServer();
  return singleton;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isThreadStatus(value: string): value is AgentThread["status"] {
  return ["active", "idle", "notLoaded", "systemError", "unknown"].includes(value);
}

function oneLine(value: string, limit = 72) {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}
