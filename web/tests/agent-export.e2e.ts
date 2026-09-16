import { expect, test } from "@playwright/test";

test.use({ channel: "chrome", acceptDownloads: true });

test("열린 내보내기 PiP가 앱 스타일과 CSS 갱신을 유지한다", async ({ page }) => {
  await page.addInitScript(() => {
    let pipWindow: Window | null = null;
    const requestWindow = async () => {
      const frame = document.createElement("iframe"); frame.id = "test-pip-window"; document.body.append(frame);
      pipWindow = frame.contentWindow; return pipWindow!;
    };
    if (window.documentPictureInPicture) Object.defineProperty(window.documentPictureInPicture, "requestWindow", { configurable: true, value: requestWindow });
    else Object.defineProperty(window, "documentPictureInPicture", { configurable: true, value: { get window() { return pipWindow; }, requestWindow } });
  });
  await page.goto("http://localhost:3000");
  await page.evaluate(() => {
    const label = [...document.querySelectorAll("label")].find((candidate) => candidate.textContent?.includes("항상 위 AI 내보내기"))!;
    const input = label.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    input.disabled = false;
    label.click();
  });
  await expect.poll(() => page.evaluate(() => Boolean(document.querySelector<HTMLIFrameElement>("#test-pip-window")?.contentWindow)), { timeout: 15_000 }).toBe(true);
  const layout = await page.evaluate(() => {
    const root = document.querySelector<HTMLIFrameElement>("#test-pip-window")!.contentDocument!;
    const panel = root.querySelector<HTMLElement>('main[aria-label="AI 맥락 내보내기"]')!;
    const buttons = [...panel.querySelectorAll<HTMLButtonElement>('[role="group"] button')];
    const buttonParentStyle = root.defaultView!.getComputedStyle(buttons[0].parentElement!);
    return { background: root.defaultView!.getComputedStyle(panel).backgroundColor, columns: buttonParentStyle.gridTemplateColumns,
      display: buttonParentStyle.display, sameRow: buttons.every((button) => Math.abs(button.getBoundingClientRect().top - buttons[0].getBoundingClientRect().top) < 2) };
  });
  expect(layout.background).toBe("rgb(17, 18, 16)");
  expect(layout.display).toBe("grid");
  expect(layout.columns).not.toBe("none");
  expect(layout.sameRow).toBe(true);
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const sheet = [...document.styleSheets].find((candidate) => { try { return Boolean(candidate.cssRules); } catch { return false; } })!;
    sheet.insertRule(".pip-cssom-probe { border-top: 9px solid rgb(1, 2, 3) !important; }");
    document.querySelector<HTMLIFrameElement>("#test-pip-window")!.contentDocument!.querySelector<HTMLElement>('main[aria-label="AI 맥락 내보내기"]')!.classList.add("pip-cssom-probe");
  });
  await expect.poll(() => page.evaluate(() => {
    const pip = document.querySelector<HTMLIFrameElement>("#test-pip-window")!.contentWindow!;
    return pip.getComputedStyle(pip.document.querySelector<HTMLElement>('main[aria-label="AI 맥락 내보내기"]')!).borderTopWidth;
  })).toBe("9px");
  await page.evaluate(() => document.querySelector("#test-pip-window")?.remove());
});

test("Local Folder는 저장 경로와 실제 작성 파일을 같은 프롬프트로 전달한다", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const files: Record<string, string | number> = {};
    (window as Window & { agentExportFiles?: typeof files }).agentExportFiles = files;
    const directory = (prefix: string): FileSystemDirectoryHandle => ({
      name: prefix.split("/").filter(Boolean).at(-1) || "dd",
      getDirectoryHandle: async (name: string) => directory(`${prefix}${name}/`),
      getFileHandle: async (name: string) => ({ createWritable: async () => ({
        write: async (value: File) => { files[`${prefix}${name}`] = value.type.startsWith("text/") ? await value.text() : value.size; }, close: async () => {},
      }) }),
    }) as FileSystemDirectoryHandle;
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
    const context = canvas.getContext("2d")!; let tick = 0;
    setInterval(() => { context.fillStyle = tick++ % 2 ? "#fff" : "#222"; context.fillRect(0, 0, 640, 360); }, 300);
    navigator.mediaDevices.getDisplayMedia = async () => canvas.captureStream(10);
    Object.defineProperty(window, "documentPictureInPicture", { configurable: true, value: undefined });
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => directory("") });
  });
  await page.goto("http://localhost:3000");
  await page.getByRole("button", { name: "화면 공유 시작" }).first().click();
  await expect(page.getByText("로컬 기록 중")).toBeVisible();
  await page.waitForTimeout(1_500);
  await page.getByRole("button", { name: /Local Folder/ }).click();
  await page.getByRole("button", { name: "AI Context 생성" }).click();

  const prompt = await page.locator('textarea[readonly]').inputValue({ timeout: 30_000 });
  expect(prompt).toMatch(/저장 경로가 "dd\/Context-.*"로 끝나는/);
  const exported = await page.evaluate(() => (window as Window & { agentExportFiles?: Record<string, string | number> }).agentExportFiles!);
  const contextPath = Object.keys(exported).find((name) => /^Context-.*\/context\.md$/.test(name));
  expect(contextPath).toBeTruthy();
  expect(Object.keys(exported)).toContain(contextPath!.replace(/context\.md$/, "events.json"));
  expect(Object.keys(exported).some((name) => name.startsWith(contextPath!.replace(/context\.md$/, "captures/")) && name.endsWith(".jpg"))).toBe(true);
  expect(prompt).toContain(`dd/${contextPath!.replace(/\/context\.md$/, "")}`);
});

test("Manual은 0장에서 시작해 대표 사이 화면을 펼치고 확대·드래그·다중 다운로드한다", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
    const context = canvas.getContext("2d")!; let tick = 0;
    setInterval(() => { context.fillStyle = `hsl(${tick++ * 31} 60% 50%)`; context.fillRect(0, 0, 640, 360); }, 200);
    navigator.mediaDevices.getDisplayMedia = async () => canvas.captureStream(15);
    Object.defineProperty(window, "documentPictureInPicture", { configurable: true, value: undefined });
  });
  await page.goto("http://localhost:3000");
  await page.getByRole("button", { name: "화면 공유 시작" }).first().click();
  await expect(page.getByText("로컬 기록 중")).toBeVisible();
  await page.waitForTimeout(4_000);
  await page.getByRole("button", { name: /Manual/ }).click();

  const picker = page.getByRole("region", { name: "로컬 버퍼 화면 선택" });
  await expect(picker.getByText("선택 0장")).toBeVisible({ timeout: 30_000 });
  const representatives = picker.locator('article[data-representative="true"]');
  await expect(representatives.first()).toBeVisible();
  const representativeCount = await representatives.count();
  await page.evaluate(() => {
    const target = document.createElement("div");
    target.id = "real-drag-target";
    target.contentEditable = "true";
    target.style.cssText = "position:fixed;z-index:99999;right:8px;bottom:8px;width:120px;height:60px;background:white;color:black";
    target.addEventListener("drop", (event) => {
      const transfer = event.dataTransfer;
      const snapshot = {
        types: transfer ? [...transfer.types] : [],
        strings: transfer ? [...transfer.items].filter((item) => item.kind === "string").map((item) => item.type) : [],
        text: transfer?.getData("text/plain") ?? "",
      };
      setTimeout(() => { (window as Window & { realDrop?: unknown }).realDrop = { ...snapshot, html: target.innerHTML }; });
    });
    document.body.append(target);
  });
  const sourceBox = await representatives.first().locator("img").boundingBox();
  const targetBox = await page.locator("#real-drag-target").boundingBox();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2 + 12, sourceBox!.y + sourceBox!.height / 2, { steps: 4 });
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 20 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as Window & { realDrop?: unknown }).realDrop)).toBeTruthy();
  const realDrop = await page.evaluate(() => (window as Window & { realDrop?: { types: string[]; strings: string[]; text: string; html: string } }).realDrop!);
  expect(realDrop.types).toEqual(["text/uri-list", "text/html"]);
  expect(realDrop.strings).toEqual(["text/uri-list", "text/html"]);
  expect(realDrop.text).toBe("");
  expect(realDrop.html).toContain("<img");
  expect(realDrop.html).toContain("data:image/jpeg;base64,");
  await page.locator("#real-drag-target").evaluate((element) => element.remove());
  const gap = picker.getByRole("button", { name: /\d+개 사이 화면/ }).first();
  await gap.click();
  const middle = picker.locator('article[data-representative="false"]');
  await expect(middle.first()).toBeVisible();
  expect(await picker.locator("article").count()).toBeGreaterThan(representativeCount);

  await middle.first().getByRole("button", { name: /화면 크게 보기/ }).click();
  await expect(page.getByRole("dialog", { name: "화면 크게 보기" })).toBeVisible();
  await page.getByRole("button", { name: "크게 보기 닫기" }).click();

  await middle.first().getByRole("button", { name: "선택" }).click();
  await representatives.first().getByRole("button", { name: "선택" }).click();
  await expect(picker.getByText("선택 2장")).toBeVisible();
  const downloads: string[] = [];
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  await picker.getByRole("button", { name: "선택한 2장 다운로드" }).click();
  await expect.poll(() => downloads.length).toBe(2);
  expect(downloads.every((name) => /^screen-.*\.jpg$/.test(name))).toBe(true);

  const selectedLabel = picker.getByText("선택 2장");
  const refresh = picker.getByRole("button", { name: "현재 화면으로 갱신" });
  const [labelBox, refreshBox] = await Promise.all([selectedLabel.boundingBox(), refresh.boundingBox()]);
  expect(Math.abs(labelBox!.y - refreshBox!.y)).toBeLessThan(8);
  await page.waitForTimeout(500);
  await refresh.click();
  await expect(refresh).toBeEnabled({ timeout: 30_000 });
  await expect(picker.getByText("선택 0장")).toBeVisible();
  const refreshedImage = picker.locator('article[data-representative="true"] img').first();
  await expect(refreshedImage).toHaveAttribute("src", /^data:image\/jpeg;base64,/);
  expect(await refreshedImage.evaluate((image) => (image as HTMLImageElement).draggable)).toBe(true);
});

test("Agent Link와 Local Folder가 같은 화면 맥락을 전달한다", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const files: Record<string, number | string> = {};
    (window as Window & { agentExportFiles?: typeof files }).agentExportFiles = files;
    const directory = (prefix: string): FileSystemDirectoryHandle => ({
      name: prefix.split("/").filter(Boolean).at(-1) || "WhatWasThat",
      getDirectoryHandle: async (name: string) => directory(`${prefix}${name}/`),
      getFileHandle: async (name: string) => ({ createWritable: async () => ({
        write: async (value: File) => { files[`${prefix}${name}`] = value.type.startsWith("text/") ? await value.text() : value.size; }, close: async () => {},
      }) }),
    }) as FileSystemDirectoryHandle;
    const canvas = document.createElement("canvas"); canvas.width = 1280; canvas.height = 720;
    const context = canvas.getContext("2d")!; let tick = 0;
    setInterval(() => {
      context.fillStyle = tick++ % 2 ? "#9a1c18" : "#f4f2ed"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#111"; context.font = "48px Arial"; context.fillText(`화면 변화 ${tick}`, 100, 100);
    }, 400);
    navigator.mediaDevices.getDisplayMedia = async () => canvas.captureStream(15);
    Object.defineProperty(window, "documentPictureInPicture", { configurable: true, value: undefined });
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => directory("") });
  });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:3000" });
  const filenames: string[] = [];
  page.on("download", (download) => filenames.push(download.suggestedFilename()));
  await page.goto("http://localhost:3000");
  await page.getByRole("button", { name: "화면 공유 시작" }).first().click();
  await expect(page.getByText("로컬 기록 중")).toBeVisible();
  await page.waitForTimeout(2_000);
  await page.getByRole("combobox", { name: "버퍼 길이" }).selectOption("1");
  await page.getByRole("combobox", { name: "전송 구간" }).selectOption("30");

  await page.getByRole("button", { name: "AI Context 생성" }).click();
  const prompt = await page.locator('textarea[readonly]').inputValue({ timeout: 30_000 });
  const agentUrl = prompt.match(/https?:\/\/\S+\/context\/[A-Za-z0-9_-]+\/agent/)?.[0];
  expect(agentUrl).toBeTruthy();
  expect(prompt).toContain("최근 30초");
  expect(filenames).toHaveLength(0);
  const agentResponse = await page.request.get(agentUrl!);
  expect(agentResponse.status()).toBe(200);
  const agentHtml = await agentResponse.text();
  expect(agentHtml).toContain("화면 타임라인");
  expect(agentHtml).toContain("context.md");
  expect(agentHtml).toContain("<img");
  expect(agentResponse.headers()["cache-control"]).toBe("no-store");
  expect(agentResponse.headers()["referrer-policy"]).toBe("no-referrer");
  expect(agentResponse.headers()["x-robots-tag"]).toContain("noindex");
  const firstImage = agentHtml.match(/<img src="([^"]+)"/)?.[1];
  expect(firstImage).toBeTruthy();
  const imageResponse = await page.request.get(new URL(firstImage!, agentUrl!).href);
  expect(imageResponse.status()).toBe(200);
  expect(imageResponse.headers()["content-type"]).toMatch(/^image\//);
  expect((await imageResponse.body()).byteLength).toBeGreaterThan(0);
  await page.getByRole("button", { name: "프롬프트 복사" }).click();
  expect((await page.evaluate(() => navigator.clipboard.readText())).replaceAll("\r\n", "\n")).toBe(prompt.replaceAll("\r\n", "\n"));

  await page.getByRole("button", { name: /Local Folder/ }).click();
  await expect.poll(async () => (await page.request.get(agentUrl!)).status()).toBe(200);
  await page.getByRole("button", { name: "AI Context 생성" }).click();
  const folderPrompt = await page.locator('textarea[readonly]').inputValue({ timeout: 30_000 });
  expect(folderPrompt).toMatch(/저장 경로가 "WhatWasThat\/Context-.*"로 끝나는/);
  await expect.poll(() => page.evaluate(() => {
    const names = Object.keys((window as Window & { agentExportFiles?: Record<string, unknown> }).agentExportFiles!);
    return names.some((name) => /Context-.*\/context\.md$/.test(name)) && names.some((name) => /Context-.*\/events\.json$/.test(name)) && names.filter((name) => /\/captures\/.*\.jpg$/.test(name)).length >= 6;
  }), { timeout: 30_000 }).toBe(true);
  const exported = await page.evaluate(() => (window as Window & { agentExportFiles?: Record<string, string | number> }).agentExportFiles!);
  expect(Object.keys(exported).some((name) => /Context-.*\/context\.md$/.test(name))).toBe(true);
  expect(Object.keys(exported).some((name) => /Context-.*\/events\.json$/.test(name))).toBe(true);
  expect(Object.keys(exported).filter((name) => /\/captures\/.*\.jpg$/.test(name)).length).toBeGreaterThanOrEqual(6);
  expect(Object.values(exported).find((value) => typeof value === "string")).not.toMatch(/자료 출처|사용자가 허용한|공유 범위/);

});
