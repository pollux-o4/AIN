import type { StorybookConfig } from "@storybook/react-vite";

// 화면 상태 카탈로그 · 서버 없이 fixture로 렌더한다 (시각 회귀 기준)
const config: StorybookConfig = {
  stories: ["../automation/editorial/ui/**/*.stories.tsx"],
  framework: { name: "@storybook/react-vite", options: {} },
  core: { disableTelemetry: true },
  viteFinal: (vite) => ({ ...vite, base: "/", server: { ...vite.server, proxy: undefined } }),
};
export default config;
