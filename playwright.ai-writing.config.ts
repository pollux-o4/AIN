import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: [
    "ai-writing.spec.ts",
    "ai-writing-legacy.spec.ts",
    "ai-writing-vite.spec.ts",
    "ai-writing-direction.spec.ts",
    "ai-writing-brief.spec.ts",
    "ai-writing-figure.spec.ts",
  ],
  // 글마다 독립 기록 · 공유 서버에서 병렬 실행
  fullyParallel: true,
  workers: 4,
  timeout: 90000,
  expect: { timeout: 30000 },
  reporter: [["list"]],
  outputDir: ".local/editorial-qa/results",
  use: {
    baseURL: "http://127.0.0.1:3356",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      command: "mise exec -- node automation/editorial/tests/browser-server.mjs",
      // 시각자료 층별 모델도 fixture로 · 실제 AI 비용 호출 없음
      env: Object.fromEntries(
        ["PLAN", "DRAFT", "CONTENT", "VISUAL"].map((role) => [
          `AIN_FIGURE_AI_${role}`,
          "fixture/fixture-model",
        ]),
      ),
      url: "http://127.0.0.1:3356/write/",
      gracefulShutdown: { signal: "SIGTERM", timeout: 15000 },
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: "node_modules/.bin/vite --host 127.0.0.1 --port 5183 --strictPort",
      env: { EDITORIAL_DEV_API_URL: "http://127.0.0.1:3356" },
      url: "http://127.0.0.1:5183/write/",
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
});
