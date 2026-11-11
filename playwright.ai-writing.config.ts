import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: [
    "ai-writing.spec.ts",
    "ai-writing-legacy.spec.ts",
    "ai-writing-vite.spec.ts",
    "ai-writing-direction.spec.ts",
  ],
  fullyParallel: false,
  workers: 1,
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
      url: "http://127.0.0.1:3356/write/",
      gracefulShutdown: { signal: "SIGTERM", timeout: 15000 },
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: "node_modules/.bin/vite --host 127.0.0.1 --port 5173 --strictPort",
      env: { EDITORIAL_DEV_API_URL: "http://127.0.0.1:3356" },
      url: "http://127.0.0.1:5173/write/",
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
});
