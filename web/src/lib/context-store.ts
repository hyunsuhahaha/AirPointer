import "server-only";

import { del, get, head, put } from "@vercel/blob";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const CONTEXT_TTL_MS = 20 * 60 * 1_000;
const MAX_CONTEXT_BYTES = 250 * 1024 * 1024;
const MAX_CONTEXT_FILES = 400;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;
const root = process.env.WHATWAS_CONTEXT_DIR || path.join(tmpdir(), "whatwas-contexts");
const blobPrefix = "whatwas-contexts";

export type StoredContextFile = { path: string; type: string; size: number };
export type StoredContext = {
  token: string;
  createdAt: number;
  expiresAt: number;
  seconds: number;
  files: StoredContextFile[];
};

export function safeRelativePath(value: string) {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0") || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("허용되지 않은 Context 파일 경로입니다.");
  }
  return normalized;
}

export function safeContentType(filePath: string, submittedType: string) {
  if (filePath === "context.md") return "text/markdown; charset=utf-8";
  if (filePath === "events.json") return "application/json; charset=utf-8";
  if (/^captures\/[A-Za-z0-9._/-]+\.(?:jpe?g|png)$/i.test(filePath) && ["image/jpeg", "image/png"].includes(submittedType)) return submittedType;
  if (/^recording\/[A-Za-z0-9._/-]+\.webm$/i.test(filePath)) return "video/webm";
  throw new Error("허용되지 않은 Context 파일 형식입니다.");
}

export function blobContextStorageEnabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID));
}

export function newContextIdentity(seconds: number) {
  const now = Date.now();
  return {
    token: randomBytes(32).toString("base64url"),
    createdAt: now,
    expiresAt: now + CONTEXT_TTL_MS,
    seconds: Math.max(1, Math.min(300, Math.round(seconds))),
  };
}

export function contextBlobPath(token: string, filePath: string) {
  if (!TOKEN_PATTERN.test(token)) throw new Error("Context 토큰이 올바르지 않습니다.");
  return `${blobPrefix}/${token}/${safeRelativePath(filePath)}`;
}

export function validateContextFiles(files: StoredContextFile[]) {
  if (files.length > MAX_CONTEXT_FILES) throw new Error("Context 파일이 너무 많습니다.");
  const checked = files.map((file) => ({ ...file, path: safeRelativePath(file.path), type: safeContentType(file.path, file.type) }));
  if (new Set(checked.map((file) => file.path)).size !== checked.length) throw new Error("Context 파일 경로가 중복되었습니다.");
  const total = checked.reduce((sum, file) => sum + file.size, 0);
  if (!checked.length || total > MAX_CONTEXT_BYTES) throw new Error("Context 자료 크기가 너무 큽니다.");
  if (!checked.some((file) => file.path === "context.md") || !checked.some((file) => file.path.startsWith("captures/") && file.type.startsWith("image/"))) {
    throw new Error("Context 문서 또는 화면 이미지가 없습니다.");
  }
  return checked;
}

export async function finalizeBlobStoredContext(input: { token: string; createdAt: number; expiresAt: number; seconds: number; files: StoredContextFile[] }) {
  if (!blobContextStorageEnabled() || !TOKEN_PATTERN.test(input.token) || input.expiresAt <= Date.now() || input.expiresAt > Date.now() + CONTEXT_TTL_MS) {
    throw new Error("Context 생성 정보가 올바르지 않습니다.");
  }
  const files = validateContextFiles(input.files);
  await Promise.all(files.map(async (file) => {
    const stored = await head(contextBlobPath(input.token, file.path));
    if (stored.size !== file.size || safeContentType(file.path, stored.contentType) !== file.type) throw new Error("업로드된 Context 파일이 올바르지 않습니다.");
  }));
  const manifest: StoredContext = { ...input, seconds: Math.max(1, Math.min(300, Math.round(input.seconds))), files };
  await put(contextBlobPath(input.token, "manifest.json"), JSON.stringify(manifest), {
    access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: false,
  });
  return manifest;
}

function contextDirectory(token: string) {
  if (!TOKEN_PATTERN.test(token)) return null;
  return path.join(root, token);
}

async function cleanExpiredContexts(now = Date.now()) {
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    try {
      const manifest = JSON.parse(await readFile(path.join(root, entry.name, "manifest.json"), "utf8")) as StoredContext;
      if (manifest.expiresAt <= now) await rm(path.join(root, entry.name), { recursive: true, force: true });
    } catch {
      if (entry.name.endsWith(".tmp")) await rm(path.join(root, entry.name), { recursive: true, force: true });
    }
  }));
}

export async function createStoredContext(input: { seconds: number; files: { path: string; type: string; bytes: Uint8Array }[] }) {
  await cleanExpiredContexts();
  if (input.files.length > MAX_CONTEXT_FILES) throw new Error("Context 파일이 너무 많습니다.");
  const files = input.files.map((file) => {
    const filePath = safeRelativePath(file.path);
    return { ...file, path: filePath, type: safeContentType(filePath, file.type) };
  });
  if (new Set(files.map((file) => file.path)).size !== files.length) throw new Error("Context 파일 경로가 중복되었습니다.");
  const total = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  if (!files.length || total > MAX_CONTEXT_BYTES) throw new Error("Context 자료 크기가 너무 큽니다.");
  if (!files.some((file) => file.path === "context.md") || !files.some((file) => file.path.startsWith("captures/") && file.type.startsWith("image/"))) {
    throw new Error("Context 문서 또는 화면 이미지가 없습니다.");
  }
  const token = randomBytes(32).toString("base64url");
  const finalDirectory = contextDirectory(token)!;
  const temporaryDirectory = `${finalDirectory}.tmp`;
  const now = Date.now();
  const manifest: StoredContext = {
    token,
    createdAt: now,
    expiresAt: now + CONTEXT_TTL_MS,
    seconds: Math.max(1, Math.min(300, Math.round(input.seconds))),
    files: files.map((file) => ({ path: file.path, type: file.type || "application/octet-stream", size: file.bytes.byteLength })),
  };
  await mkdir(temporaryDirectory, { recursive: true });
  try {
    for (const file of files) {
      const destination = path.join(temporaryDirectory, ...file.path.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, file.bytes);
    }
    await writeFile(path.join(temporaryDirectory, "manifest.json"), JSON.stringify(manifest), "utf8");
    await rename(temporaryDirectory, finalDirectory);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
  return manifest;
}

export async function readStoredContext(token: string) {
  const directory = contextDirectory(token);
  if (!directory) return null;
  if (blobContextStorageEnabled()) {
    try {
      const result = await get(contextBlobPath(token, "manifest.json"), { access: "private", useCache: false });
      if (!result || result.statusCode !== 200 || !result.stream) return null;
      const manifest = JSON.parse(await new Response(result.stream).text()) as StoredContext;
      if (manifest.token !== token || manifest.expiresAt <= Date.now()) {
        await deleteStoredContext(token);
        return null;
      }
      return manifest;
    } catch { return null; }
  }
  try {
    const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as StoredContext;
    if (manifest.token !== token || manifest.expiresAt <= Date.now()) {
      await rm(directory, { recursive: true, force: true });
      return null;
    }
    return manifest;
  } catch {
    return null;
  }
}

export async function readStoredContextFile(token: string, requestedPath: string) {
  const manifest = await readStoredContext(token);
  if (!manifest) return null;
  let filePath: string;
  try { filePath = safeRelativePath(requestedPath); }
  catch { return null; }
  const file = manifest.files.find((entry) => entry.path === filePath);
  const directory = contextDirectory(token);
  if (!file || !directory) return null;
  if (blobContextStorageEnabled()) {
    try {
      const result = await get(contextBlobPath(token, filePath), { access: "private" });
      if (!result || result.statusCode !== 200 || !result.stream) return null;
      return { file, bytes: Buffer.from(await new Response(result.stream).arrayBuffer()) };
    } catch { return null; }
  }
  try { return { file, bytes: await readFile(path.join(directory, ...filePath.split("/"))) }; }
  catch { return null; }
}

export async function deleteStoredContext(token: string) {
  const directory = contextDirectory(token);
  if (!directory) return false;
  if (blobContextStorageEnabled()) {
    const manifest = await readStoredContextWithoutExpiry(token);
    if (!manifest) return false;
    await del([...manifest.files.map((file) => contextBlobPath(token, file.path)), contextBlobPath(token, "manifest.json")]);
    return true;
  }
  const exists = Boolean(await readStoredContext(token));
  await rm(directory, { recursive: true, force: true });
  return exists;
}

async function readStoredContextWithoutExpiry(token: string) {
  try {
    const result = await get(contextBlobPath(token, "manifest.json"), { access: "private", useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return JSON.parse(await new Response(result.stream).text()) as StoredContext;
  } catch { return null; }
}
