import { chromium, expect, test } from "@playwright/test";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const APP_URL = process.env.AIRPOINTER_E2E_URL || "http://127.0.0.1:3000";

test("real Chrome tab capture keeps a transient event in the adaptive replay", async () => {
  test.skip(process.env.AIRPOINTER_REAL_SCREEN_SHARE !== "1", "Set AIRPOINTER_REAL_SCREEN_SHARE=1 and choose the AirPointer tab in Chrome's share picker.");
  test.setTimeout(90_000);
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: false,
    args: [
      "--enable-experimental-web-platform-features",
      "--auto-select-tab-capture-source-by-title=AirPointer E2E Source",
      "--window-size=1440,900",
    ],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  try {
    const app = await context.newPage();
    await app.addInitScript(() => {
      const original = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getDisplayMedia = (constraints) => original({ ...constraints, selfBrowserSurface: "include" } as DisplayMediaStreamOptions);
    });
    const requests: Array<{ frames: string[]; exploration?: { round: number } }> = [];
    await app.route("**/api/analyze", async (route) => {
      const body = route.request().postDataJSON() as { frames: string[]; exploration?: { round: number } };
      requests.push(body);
      if ((body.exploration?.round ?? 0) === 0) {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ explorationRequests: [{ type: "frames", offsetsSeconds: [-2.4, -2.0, -1.6] }] }) });
      } else {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ analysis: "0.5초 동안 나타난 TRANSIENT ERROR를 찾았습니다.", evidence: [{ frameIndex: body.frames.length - 1, claim: "순간 오류 화면" }] }) });
      }
    });
    await app.goto(APP_URL);
    await app.evaluate(() => { document.title = "AirPointer E2E Source"; });
    await app.getByLabel("전송 전 개인정보 자동 가림").setChecked(false, { force: true, timeout: 5_000 });
    await app.getByRole("button", { name: "화면 공유 시작" }).first().click({ timeout: 5_000 });
    await expect(app.getByText("로컬 기록 중")).toBeVisible({ timeout: 15_000 });

    await app.evaluate(() => {
      const event = document.createElement("div");
      event.id = "screen-share-e2e-event";
      event.textContent = "TRANSIENT ERROR · Visible for only 500 milliseconds";
      Object.assign(event.style, { position: "fixed", zIndex: "99999", top: "140px", right: "60px", width: "480px", padding: "42px", background: "#5a1712", border: "5px solid #ff7058", color: "white", font: "700 26px Arial" });
      document.body.append(event);
      setTimeout(() => event.remove(), 500);
    });
    await app.waitForTimeout(3_500);
    await app.getByRole("button", { name: /최근 15초 확인하기/ }).click();
    await expect(app.getByText("0.5초 동안 나타난 TRANSIENT ERROR를 찾았습니다.")).toBeVisible({ timeout: 30_000 });
    await expect(app.getByLabel("분석 성능 측정").first()).toContainText("총");
    expect(requests).toHaveLength(2);
    expect(requests[0].frames).toHaveLength(6);
    expect(requests[1].frames.length).toBeGreaterThan(6);

    const retainedTransientPixels = await app.evaluate(async (urls) => {
      for (const url of urls) {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let red = 0;
        for (let index = 0; index < pixels.length; index += 64) if (pixels[index] > 150 && pixels[index + 1] < 90 && pixels[index + 2] < 90) red += 1;
        if (red > 30) return true;
      }
      return false;
    }, requests[1].frames);
    expect(retainedTransientPixels).toBe(true);
  } finally {
    await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  }
});
