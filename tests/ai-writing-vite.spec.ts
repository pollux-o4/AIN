import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { ready } from "./writing";

test("Vite: 세션 인증 → 초안 → 정확한 TXT 프록시와 Tailwind 레이아웃", async ({
  page,
}, testInfo) => {
  const origin = "http://127.0.0.1:5173";
  expect(await page.context().cookies(origin)).toEqual([]);
  const sessionResponse = page.waitForResponse(`${origin}/write/session`);
  await page.goto(`${origin}/write/`);
  expect((await sessionResponse).status()).toBe(204);
  const cookie = (await page.context().cookies(`${origin}/write/`)).find(
    (item) => item.name === "editorial-session",
  );
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/write/" });
  expect(await page.evaluate(() => document.cookie)).not.toContain("editorial-session=");
  const privateArtifact = await page.request.get(
    `${origin}/write/@fs${process.cwd()}/.local/editorial-web/index.html`,
  );
  expect(privateArtifact.status()).toBe(403);
  const idea = `Vite 프록시 ${testInfo.project.name} ${Date.now()}`;
  await page.getByLabel("글감과 원하는 결과").fill(idea);
  await page.getByRole("button", { name: "초안 만들기", exact: true }).click();
  const download = page.getByRole("link", { name: "TXT 내려받기", exact: true });
  await ready(page);
  const runId = new URL(page.url()).hash.slice(1);
  const response = await page.request.get(`${origin}/write/api/runs/${runId}`);
  expect(response.ok()).toBe(true);
  const run = await response.json();
  expect(run.idea).toBe(idea);
  const exactText = `# 쇼핑몰 아키텍처\n\n첫 초안입니다. 주문과 결제를 나누는 이유를 설명합니다.\n\n요청: ${idea}\n\n[참고 자료](https://example.test/evidence)\n`;
  expect(run.text).toBe(exactText.trimEnd());
  await expect(download).toHaveAttribute("href", `/write/api/runs/${runId}/download`);
  const exported = await page.request.get(`${origin}/write/api/runs/${runId}/download`);
  expect(exported.status()).toBe(200);
  expect(exported.headers()["content-type"]).toBe("text/plain; charset=utf-8");
  expect(exported.headers()["content-disposition"]).toContain(`article-${runId}-r1.txt`);
  expect(await exported.text()).toBe(exactText);
  const filePromise = page.waitForEvent("download");
  await download.click();
  const file = await filePromise;
  expect(file.suggestedFilename()).toBe(`article-${runId}-r1.txt`);
  expect(await file.failure()).toBeNull();
  const filePath = await file.path();
  if (!filePath) throw new Error("Vite TXT download did not produce a local file");
  expect(await readFile(filePath, "utf8")).toBe(exactText);
  await expect(page.locator("header")).toHaveCSS("display", "flex");
  await expect(page.locator("header")).toHaveCSS("justify-content", "space-between");
  await expect(page.locator(".brand")).toHaveCSS("gap", "10px");
  await expect(page.locator(".result-heading")).toHaveCSS("justify-content", "flex-end");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath(`vite-ready-${colorScheme}.png`),
      fullPage: true,
    });
  }
});
