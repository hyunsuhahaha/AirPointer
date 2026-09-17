import { upload } from "@vercel/blob/client";
import type { LinkTtl } from "./link-ttl";

export type AgentLink = { token: string; url: string; expiresAt: number | null; createdAt: number; seconds: number };

export async function createAgentLink(files: File[], seconds: number, ttlMinutes: LinkTtl): Promise<AgentLink> {
  const createdAt = Date.now();
  const sharedFiles = files.filter((file) => file.name === "context.md" || file.name === "events.json" ||
    (file.name.startsWith("captures/") && !file.name.startsWith("captures/preview/") && file.type.startsWith("image/")));
  const prepared = await fetch("/api/contexts/init", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seconds, ttlMinutes, files: sharedFiles.map((file) => ({ path: file.name, type: file.type, size: file.size })) }),
  });
  const setup = await prepared.json() as { storage?: "local" | "blob"; token?: string; createdAt?: number; expiresAt?: number | null; error?: string };
  if (!prepared.ok) throw new Error(setup.error || "Agent Link를 준비하지 못했습니다.");
  if (setup.storage === "blob" && setup.token && setup.createdAt && setup.expiresAt !== undefined) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 60_000);
    try {
      for (let index = 0; index < sharedFiles.length; index += 3) {
        await Promise.all(sharedFiles.slice(index, index + 3).map((file) => upload(`whatwas-contexts/${setup.token}/${file.name}`, file, {
          access: "private", handleUploadUrl: "/api/contexts/upload", contentType: file.type.split(";", 1)[0], abortSignal: controller.signal,
          clientPayload: JSON.stringify({ token: setup.token, path: file.name, type: file.type }),
        })));
      }
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Agent Link 업로드가 60초 안에 끝나지 않았습니다. 다시 시도해 주세요.");
      throw error;
    } finally { window.clearTimeout(timeout); }
    const finalized = await fetch("/api/contexts/finalize", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: setup.token, createdAt: setup.createdAt, expiresAt: setup.expiresAt, seconds,
        files: sharedFiles.map((file) => ({ path: file.name, type: file.type, size: file.size })) }),
    });
    const result = await finalized.json() as { token?: string; expiresAt?: number | null; agentPath?: string; error?: string };
    if (!finalized.ok || !result.token || result.expiresAt === undefined || !result.agentPath) throw new Error(result.error || "Agent Link를 완성하지 못했습니다.");
    return { token: result.token, expiresAt: result.expiresAt, createdAt, seconds, url: new URL(result.agentPath, window.location.origin).href };
  }
  const form = new FormData();
  form.set("seconds", String(seconds));
  form.set("ttlMinutes", String(ttlMinutes));
  form.set("paths", JSON.stringify(sharedFiles.map((file) => file.name)));
  for (const file of sharedFiles) form.append("files", file, file.name.split("/").at(-1));
  const response = await fetch("/api/contexts", { method: "POST", body: form });
  const data = await response.json() as { token?: string; expiresAt?: number | null; agentPath?: string; error?: string };
  if (!response.ok || !data.token || data.expiresAt === undefined || !data.agentPath) throw new Error(data.error || "Agent Link를 만들지 못했습니다.");
  return { token: data.token, expiresAt: data.expiresAt, createdAt, seconds, url: new URL(data.agentPath, window.location.origin).href };
}

export async function deleteAgentLink(token: string, keepalive = false) {
  const response = await fetch(`/api/contexts/${encodeURIComponent(token)}`, { method: "DELETE", keepalive });
  if (!response.ok && response.status !== 404) throw new Error("Agent Link를 삭제하지 못했습니다.");
}
