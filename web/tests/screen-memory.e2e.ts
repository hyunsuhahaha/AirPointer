import { expect, test } from "@playwright/test";

const APP_URL = process.env.AIRPOINTER_E2E_URL || "http://localhost:3000";
test.use({ channel: "chrome" });

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 768, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`screen memory's six features are usable at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(APP_URL);
    await page.getByRole("tab", { name: "확장 기능" }).click();
    await page.getByText("화면 기록을 이 브라우저에 영구 보관 (선택)", { exact: true }).click();
    const workbench = page.getByRole("region", { name: "화면을 찾고, 되감고, 기록합니다." });
    await workbench.scrollIntoViewIfNeeded();
    await expect(workbench.getByRole("button", { name: /화면 검색/ })).toBeVisible();
    await expect(workbench.getByRole("button", { name: /Agent API/ })).toBeVisible();
    await workbench.getByRole("button", { name: /샘플 개발 기록으로 체험/ }).click();
    await expect(workbench.getByText("최근 화면 기록 6개")).toBeVisible();

    const search = workbench.getByPlaceholder(/오류, 파일명/);
    await search.fill("TypeError");
    await expect(workbench.getByText(/검색 결과 1개/)).toBeVisible();
    await search.fill("");

    await workbench.getByRole("button", { name: /시간여행/ }).click();
    await expect(workbench.getByRole("slider", { name: "화면 기록 시간 이동" })).toBeVisible();
    await workbench.getByRole("button", { name: /북마크·태그/ }).click();
    await expect(workbench.getByText("북마크 이름")).toBeVisible();
    await workbench.getByRole("button", { name: /활동 요약/ }).click();
    await expect(workbench.getByText("선택 기간 활동")).toBeVisible();
    await workbench.getByRole("button", { name: "개발 리포트 재현 기록을 Markdown으로", exact: true }).click();
    await expect(workbench.getByText("30분마다 자동 리포트")).toBeVisible();
    await workbench.getByRole("button", { name: /Agent API/ }).click();
    await expect(workbench.getByText("Codex MCP 실행")).toBeVisible();
  });
}
