import { expect, test } from "@playwright/test";
import { checkAccessibility } from "./accessibility";
import { ready } from "./writing";

test.beforeEach(async ({ page }) => {
  await page.goto("/write/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("글 방향: 기본 자동 → 키보드 선택 → 요청 전달 → 글 설계 표시", async ({ page }, testInfo) => {
  const mode = page.getByRole("group", { name: "글의 성격" });
  const level = page.getByRole("group", { name: "독자 수준" });
  await expect(mode.getByRole("radio", { name: "자동" })).toBeChecked();
  await expect(level.getByRole("radio", { name: "자동" })).toBeChecked();
  await expect(page.locator("#mode-hint")).toContainText("AI가 정합니다");
  await checkAccessibility(page, testInfo, "direction-compose");

  // 네이티브 라디오 그룹: 화살표 키로 이동·선택
  await mode.getByRole("radio", { name: "자동" }).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(mode.getByRole("radio", { name: "따라 하기" })).toBeChecked();
  await expect(page.locator("#mode-hint")).toContainText("순서대로 해 보게 하는 글");
  await level.getByRole("radio", { name: "입문" }).check();
  await expect(level.getByRole("radio", { name: "입문" })).toBeChecked();

  // 새로고침해도 선택 보존
  await page
    .getByLabel("글감과 원하는 결과")
    .fill(`방향 선택 ${testInfo.project.name} ${Date.now()}`);
  await page.reload();
  await expect(mode.getByRole("radio", { name: "따라 하기" })).toBeChecked();
  await expect(level.getByRole("radio", { name: "입문" })).toBeChecked();

  const request = page.waitForRequest(
    (req) => req.method() === "POST" && req.url().endsWith("/write/api/runs"),
  );
  await page.getByRole("button", { name: "초안 만들기", exact: true }).click();
  expect((await request).postDataJSON().direction).toEqual({
    mode: "procedure",
    readerLevel: "beginner",
  });
  const run = await ready(page);
  expect(run.design).toMatchObject({ mode: "procedure", modeBy: "user", levelBy: "user" });

  const design = page.getByRole("region", { name: "글 설계" });
  await expect(design).toContainText("따라 하기");
  await expect(design).toContainText("직접 고름");
  await expect(design).toContainText("입문");
  await design.getByText(/구간 \d+개 보기/).click();
  const items = design.locator("#design-sections li");
  await expect(items).toHaveCount(run.design.sections.length);
  await checkAccessibility(page, testInfo, "direction-ready");
});

test("글 방향: 자동이면 AI 판단으로 표시하고 이전 저장값 손상에도 기본값 복구", async ({
  page,
}, testInfo) => {
  await page.evaluate(() =>
    localStorage.setItem(
      "ain-editorial-input",
      JSON.stringify({ idea: "손상 복구", source: "", direction: { mode: "poem" } }),
    ),
  );
  await page.reload();
  await expect(
    page.getByRole("group", { name: "글의 성격" }).getByRole("radio", { name: "자동" }),
  ).toBeChecked();
  await page
    .getByLabel("글감과 원하는 결과")
    .fill(`자동 방향 ${testInfo.project.name} ${Date.now()}`);
  await page.getByRole("button", { name: "초안 만들기", exact: true }).click();
  const run = await ready(page);
  expect(run.design.modeBy).toBe("ai");
  await expect(page.getByRole("region", { name: "글 설계" })).toContainText("AI 판단");
});
