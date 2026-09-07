import { chromium, expect, test } from "@playwright/test";

// Real getDisplayMedia + native Document PiP + actual development interactions.
// No sample replay, injected capture stream, or canned answer in this test.
test("native PiP finds the transient developer error from a shared tab", async () => {
  test.skip(process.env.AIRPOINTER_LIVE_PIP !== "1", "Opt-in real Chrome capture and live API");
  test.setTimeout(180_000);
  const browser = await chromium.launch({ channel: "chrome", headless: false, args: [
    "--auto-select-tab-capture-source-by-title=Developer Replay Source",
    "--enable-experimental-web-platform-features",
  ] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const app = await context.newPage();
    const source = await context.newPage();
    const url = process.env.AIRPOINTER_E2E_URL || "http://localhost:3000";
    await source.goto(`${url}/developer-lab`);
    await expect(source).toHaveTitle(/Developer Replay Source/);
    await app.goto(url);
    await app.bringToFront();
    await expect(app.getByLabel("항상 위 캡처 버튼 켜기 (브라우저, 설치 불필요)")).toBeEnabled();
    await app.getByRole("button", { name: "화면 공유 시작" }).first().click();
    await expect(app.getByText("로컬 기록 중")).toBeVisible({ timeout: 12000 }).catch(async error => { console.log(JSON.stringify({ sourceTitle: await source.title(), app: await app.locator("body").innerText() })); throw error; });
    await expect.poll(() => app.evaluate(() => Boolean(window.documentPictureInPicture?.window)), { timeout: 10000 }).toBe(true);
    await source.bringToFront();
    await source.waitForTimeout(1500);
    await source.getByRole("button", { name: "임시저장 필터" }).click();
    await source.getByRole("button", { name: "새로고침 실행" }).click();
    await expect(source.getByText("오류 로그 발생", { exact: true })).toBeVisible();
    await expect(source.getByText("후속 로그가 이어졌어요. 방금 무슨 일이었을까요?", { exact: true })).toBeVisible();
    await source.waitForTimeout(1500);
    await source.screenshot({ path: "test-results/developer-shared-source.png" });
    await app.evaluate(() => {
      const doc = window.documentPictureInPicture!.window!.document;
      (doc.querySelector('[aria-label="최근 리플레이 첨부"]') as HTMLButtonElement).click();
    });
    await app.evaluate(() => {
      const win = window.documentPictureInPicture!.window!;
      const input = win.document.querySelector('[aria-label="AI에게 질문"]') as HTMLTextAreaElement;
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, "방금 왜 목록이 비었지? 직전에 한 작업과 놓친 오류를 찾아줘.");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect.poll(() => app.evaluate(() => {
      const doc = window.documentPictureInPicture!.window!.document;
      const button = doc.querySelector('button[type="submit"]') as HTMLButtonElement;
      return button && !button.disabled;
    })).toBe(true);
    await app.evaluate(() => (window.documentPictureInPicture!.window!.document.querySelector('button[type="submit"]') as HTMLButtonElement).click());
    await expect.poll(() => app.evaluate(() => window.documentPictureInPicture?.window?.document.body.innerText || ""), { timeout: 140_000 }).toMatch(/TypeError|undefined|reading ['’]map/);
    await expect.poll(() => app.evaluate(() => window.documentPictureInPicture?.window?.document.querySelectorAll('[aria-label="답변 화면 근거"] button').length || 0)).toBeGreaterThan(0);
    const result = await app.evaluate(() => window.documentPictureInPicture!.window!.document.body.innerText);
    expect(result).toMatch(/임시저장|필터/);
    await app.evaluate(() => (window.documentPictureInPicture!.window!.document.querySelector('[aria-label="답변 화면 근거"] button') as HTMLButtonElement).click());
    await expect.poll(() => app.evaluate(() => Boolean(window.documentPictureInPicture!.window!.document.querySelector('[role="dialog"]')))).toBe(true);
    console.log(JSON.stringify({ nativePipResult: result }));
  } finally { await browser.close(); }
});
