import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { CodexAppServer } from "../src/lib/codex-app-server.ts";

test("실제 Codex Agent가 localImage turn을 받는다", { skip: process.env.CODEX_INTEGRATION !== "1", timeout: 150_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "airpointer-agent-test-"));
  const imagePath = join(directory, "gesture-capture.png");
  await writeFile(imagePath, solidPng(8, 8, [255, 102, 24]));
  const client = new CodexAppServer();
  try {
    const threadId = await client.startEphemeralThread(process.cwd());
    const { turnId } = await client.sendToLoadedThread(threadId, "첨부 이미지가 주황색이면 AIRPOINTER_ORANGE_IMAGE라고만 답하세요.", [imagePath]);
    const completed = await client.waitForTurn(threadId, turnId);
    assert.equal(completed.status, "completed");
    assert.match(completed.text, /AIRPOINTER_ORANGE_IMAGE/);
  } finally {
    client.close();
    await rm(directory, { recursive: true, force: true });
  }
});

function solidPng(width: number, height: number, rgb: [number, number, number]) {
  const row = Buffer.from([0, ...Array.from({ length: width }, () => rgb).flat()]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), data.length + 8);
  return chunk;
}

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
