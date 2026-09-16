import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { localExportPath, localFolderPrompt } from "../src/lib/export-directory.ts";

test("Local Folder 프롬프트는 생성된 폴더 경로를 포함하고 그 경로로 자료를 조회할 수 있다", async () => {
  const contextName = "Context-2026-09-16T04-24-28-327Z";
  const relativePath = localExportPath("dd", contextName);
  const prompt = localFolderPrompt("dd", contextName);
  assert.match(prompt, /저장 경로가 "dd\/Context-2026-09-16T04-24-28-327Z"로 끝나는/);
  assert.match(prompt, /captures\/preview 폴더의 화면을 시간순으로 확인/);

  const root = await mkdtemp(join(tmpdir(), "whatwas-local-folder-"));
  try {
    const contextFolder = join(root, ...relativePath.split("/"));
    await mkdir(join(contextFolder, "captures"), { recursive: true });
    await writeFile(join(contextFolder, "context.md"), "# 테스트 맥락\n화면 기록 확인", "utf8");
    await writeFile(join(contextFolder, "events.json"), '{"events":[]}', "utf8");
    await writeFile(join(contextFolder, "captures", "frame-01.jpg"), "image");

    assert.match(await readFile(join(contextFolder, "context.md"), "utf8"), /화면 기록 확인/);
    assert.equal(JSON.parse(await readFile(join(contextFolder, "events.json"), "utf8")).events.length, 0);
    assert.equal((await readFile(join(contextFolder, "captures", "frame-01.jpg"))).length, 5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
