import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
// 공용 Paseo 모듈은 JS · 데몬 주소의 단일 출처
import { launcherListen } from "../paseo/endpoint.mjs";

const api = process.env.EDITORIAL_DEV_API_URL ?? "http://127.0.0.1:3230";

export default defineConfig({
  root: "automation/editorial/ui",
  base: "/write/",
  plugins: [react(), tailwindcss()],
  define: { __PASEO_URL__: JSON.stringify(`http://${launcherListen()}/`) },
  build: { outDir: "../../../.local/editorial-web", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    forwardConsole: false,
    fs: {
      allow: ["automation/editorial/ui", "automation/contracts", "node_modules"].map((path) =>
        resolve(path),
      ),
      deny: [".env", ".env.*", "*.{crt,pem,key}", "**/.git/**", "**/.local/**"],
    },
    proxy: {
      "/write/api": { target: api, changeOrigin: false },
      "/write/session": { target: api, changeOrigin: false },
    },
  },
});

import { resolve } from "node:path";
