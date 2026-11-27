import { chromium } from "@playwright/test";

// Measure the UI's response to its own successful API read, on the browser clock.
export async function observeBrowser(origin, id) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.addInitScript((runPath) => {
      const fetchFromPage = window.fetch.bind(window);
      let apiAt;
      window.fetch = async (...args) => {
        const response = await fetchFromPage(...args);
        const decoded = response.json.bind(response);
        if (new URL(response.url).pathname === runPath) {
          response.json = async () => {
            const data = await decoded();
            if (data.status === "awaiting_user") apiAt ??= performance.now();
            return data;
          };
        }
        return response;
      };
      window.addEventListener("DOMContentLoaded", () => {
        const observer = new MutationObserver(() => {
          const article = document.querySelector("#article");
          const download = document.querySelector('a[download][href*="/download"]');
          if (
            apiAt === undefined ||
            !article?.textContent?.trim() ||
            !download?.getClientRects().length
          )
            return;
          observer.disconnect();
          requestAnimationFrame(() => {
            window.perfBrowserRenderMs = performance.now() - apiAt;
          });
        });
        observer.observe(document.body, { attributes: true, childList: true, subtree: true });
      });
    }, `/write/api/runs/${id}`);
    const response = await page.goto(new URL(`/write/#${id}`, origin).href);
    if (!response?.ok()) throw new Error("Build the editor before measuring browser rendering");
    await page.waitForFunction(() => Number.isFinite(window.perfBrowserRenderMs), null, {
      timeout: 90000,
    });
    return await page.evaluate(() => window.perfBrowserRenderMs);
  } finally {
    await browser.close();
  }
}
