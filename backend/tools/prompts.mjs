// Node 기준 프롬프트를 Go 내장 추출본으로 다시 뽑는다 · --check는 추출본이 최신이 아니면 실패한다(생성 후 diff 방식)
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const generators = [
  "backend/internal/promptframe/generate.mjs",
  "backend/internal/writingai/templates/generate.mjs",
  "backend/internal/figureai/templates/generate.mjs",
  "backend/internal/writingai/testdata/generate.mjs",
  "backend/internal/figureai/testdata/generate.mjs",
];
const outputs = [
  "backend/internal/promptframe/frame.json",
  "backend/internal/writingai/templates/prompts.json",
  "backend/internal/figureai/templates/prompts.json",
  "backend/internal/writingai/testdata/node-reference.json",
  "backend/internal/figureai/testdata/node-reference.json",
];
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: "inherit" });
for (const generator of generators) run(process.execPath, [generator, root]);
run(fileURLToPath(new URL("node_modules/.bin/biome", `file://${root}`)), [
  "format",
  "--write",
  ...outputs,
]);
if (process.argv.includes("--check")) {
  try {
    run("git", ["diff", "--exit-code", "--stat", "--", ...outputs]);
  } catch {
    console.error(
      "Go 프롬프트 추출본이 Node 기준과 다릅니다. mise run go:prompts 결과를 검토해 커밋하세요.",
    );
    process.exit(1);
  }
}
