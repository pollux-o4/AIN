import { writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";

export async function checkAccessibility(page: Page, testInfo: TestInfo, state: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await test.step(`${state}: ${colorScheme} accessibility and layout`, async () => {
      await page.emulateMedia({ colorScheme });
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) {
          if (animation.effect?.getComputedTiming().iterations === Infinity) continue;
          try {
            animation.finish();
          } catch {
            // Detached or inactive animations need no stabilization.
          }
        }
      });
      const results = await new AxeBuilder({ page }).analyze();
      // shortcut: 가상요소·그라데이션 배경의 대비는 axe가 incomplete로 반환, 색상·배경 변경 시 첨부 결과와 실제 대비 검토
      const reportPath = testInfo.outputPath(`${state}-${colorScheme}-axe.json`);
      await writeFile(reportPath, JSON.stringify(results, null, 2));
      await testInfo.attach(`${state}-${colorScheme}-axe`, {
        path: reportPath,
        contentType: "application/json",
      });
      expect.soft(results.violations, `${state} (${colorScheme}) axe violations`).toEqual([]);
      expect
        .soft(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `${state} (${colorScheme}) horizontal overflow`,
        )
        .toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: testInfo.outputPath(`${state}-${colorScheme}.png`),
        fullPage: true,
      });
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
}
