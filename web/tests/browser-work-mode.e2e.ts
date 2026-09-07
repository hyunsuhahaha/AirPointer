import { expect, test } from "@playwright/test";

const APP_URL = process.env.AIRPOINTER_E2E_URL || "http://localhost:3000";
test.use({ channel: "chrome" });

test("screen sharing opens the always-on-top capture controls automatically", async ({ page }) => {
  await page.addInitScript(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext("2d");
    context?.fillRect(0, 0, canvas.width, canvas.height);
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: async () => canvas.captureStream(15),
    });

    const pictureInPicture = {
      window: null as Window | null,
      requestWindow: async () => {
        const frame = document.createElement("iframe");
        frame.hidden = true;
        document.body.append(frame);
        const pipWindow = frame.contentWindow!;
        pictureInPicture.window = pipWindow;
        return pipWindow;
      },
    };
    Object.defineProperty(window, "documentPictureInPicture", {
      configurable: true,
      value: pictureInPicture,
    });
  });

  await page.goto(APP_URL);
  const pipToggle = page.getByLabel("항상 위 캡처 버튼 켜기 (브라우저, 설치 불필요)");
  await expect(pipToggle).toBeEnabled();
  await expect(page.getByText("키보드 단축키 켜기 (브라우저, 설치 불필요)")).toHaveCount(0);

  await page.getByRole("button", { name: "화면 공유 시작" }).first().click();

  await expect(pipToggle).toBeChecked();
  await expect.poll(() => page.evaluate(() => Boolean(window.documentPictureInPicture?.window))).toBe(true);
});
