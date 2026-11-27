// Capture the Node reference figure instructions for the native Go prompt assembler.
// 지시문의 원천은 automation/paseo/prompts/figure.mjs·looks.mjs이며, Go는 이 추출본만 조립한다(SSoT).
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(process.argv[2] ?? ".");
const fromRoot = (path) => import(pathToFileURL(resolve(root, path)));
const { figureSpec } = await fromRoot("automation/paseo/prompts/figure.mjs");
const { FIGURE_LOOKS, FIGURE_PASSES, FIGURE_FIX_PASS } = await fromRoot(
  "automation/contracts/figure.mjs",
);
const { LAB_VARIANTS } = await fromRoot("automation/paseo/lab/variants.mjs");

// 실행 환경마다 바뀌는 값은 자리표로 남긴다
const policy = { plan: "{{policy.plan}}", check: "{{policy.check}}", draw: "{{policy.draw}}" };
const tools = {
  layoutCheck: fileURLToPath(
    new URL("automation/paseo/figure-tools/layout-check.mjs", pathToFileURL(`${root}/`)),
  ),
  kitIndex: fileURLToPath(
    new URL("automation/paseo/figure-tools/kit-index.mjs", pathToFileURL(`${root}/`)),
  ),
};
const placeholders = (value) =>
  JSON.parse(
    JSON.stringify(value)
      .replaceAll(tools.layoutCheck, "{{layoutCheck}}")
      .replaceAll(tools.kitIndex, "{{kitIndex}}"),
  );
const spec = (action) => placeholders(figureSpec(action, policy));

const figure = {};
for (const pass of [...FIGURE_PASSES, FIGURE_FIX_PASS])
  for (const look of Object.keys(FIGURE_LOOKS))
    figure[`${pass}:${look}`] = spec({ stage: "figure", pass, style: { look } });

const payload = {
  plan: spec({ stage: "figure_plan" }),
  compose: spec({ stage: "figure_compose" }),
  figure,
  defaultLook: "anatomy",
  baseline: LAB_VARIANTS.find((variant) => variant.id === "baseline").policy,
};
writeFileSync(new URL("./prompts.json", import.meta.url), `${JSON.stringify(payload, null, 2)}\n`);
