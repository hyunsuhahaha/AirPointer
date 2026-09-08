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
      value: async () => {
        const stream = canvas.captureStream(15);
        context?.fillRect(0, 0, canvas.width, canvas.height);
        return stream;
      },
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
  await expect.poll(() => page.evaluate(() => {
    const doc = window.documentPictureInPicture?.window?.document;
    return Array.from(doc?.querySelectorAll("button") ?? []).map((button) => button.textContent?.trim()).filter(Boolean);
  })).toEqual(expect.arrayContaining(["리플레이", "화면", "북마크"]));
  await expect.poll(() => page.evaluate(() => {
    const doc = window.documentPictureInPicture?.window?.document;
    return Array.from(doc?.querySelectorAll("button") ?? []).some((button) => button.textContent?.trim() === "영역");
  })).toBe(false);

  await expect.poll(() => page.evaluate(() => !(window.documentPictureInPicture!.window!.document.querySelector('[aria-label="현재 화면 선택"]') as HTMLButtonElement).disabled)).toBe(true);
  await page.evaluate(() => (window.documentPictureInPicture!.window!.document.querySelector('[aria-label="현재 화면 선택"]') as HTMLButtonElement).click());
  await expect.poll(() => page.evaluate(() => window.documentPictureInPicture?.window?.document.querySelector('[aria-label="분석할 화면 선택"]')?.textContent ?? "")).toContain("전체 화면 선택됨");
  await expect.poll(() => page.evaluate(() => {
    const selection = window.documentPictureInPicture?.window?.document.querySelector('[aria-label="분석할 화면 선택"] span[style]') as HTMLElement | null;
    return selection ? [selection.style.left, selection.style.top, selection.style.width, selection.style.height] : [];
  })).toEqual(["0%", "0%", "100%", "100%"]);

  await page.evaluate(() => window.documentPictureInPicture!.window!.document.querySelector('[aria-label^="선택 영역:"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true, bubbles: true })));
  await expect.poll(() => page.evaluate(() => {
    const section = window.documentPictureInPicture?.window?.document.querySelector('[aria-label="분석할 화면 선택"]');
    const selection = section?.querySelector("span[style]") as HTMLElement | null;
    return [section?.textContent ?? "", selection?.style.width ?? ""];
  })).toEqual([expect.stringContaining("드래그로 영역 선택"), "98%"]);
});
