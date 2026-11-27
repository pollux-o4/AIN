// Generate synthetic figure prompt parity fixtures from the Node reference, without model calls.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2] ?? ".");
const fromRoot = (path) => import(pathToFileURL(resolve(root, path)));
const { buildPrompt } = await fromRoot("automation/paseo/prompts/index.mjs");
const { FIGURE_LOOKS } = await fromRoot("automation/contracts/figure.mjs");
const tools = resolve(root, "automation/paseo/figure-tools");

const state = {
  articleId: "article",
  idea: "비교 🧪 </자료>",
  version: 7,
  revision: 3,
  artifacts: {
    audience: { revision: 1, output: { reader: "독자", intent: "하기" } },
    value: { revision: 1, output: { promise: "약속", preserve: ["조건"] } },
    outline: { revision: 1, output: { title: "제목", sections: [{ title: "첫 구간" }] } },
    draft: {
      revision: 3,
      output: { text: "# 제목\n\n도입 <b>&</b>입니다.\n\n## 첫 구간\n\n끝입니다." },
    },
  },
};
const candidate = {
  id: "f1",
  anchor: "끝입니다.",
  claim: "관계",
  kind: "flow",
  scene: "장면",
  analogy: "자판기",
};
const base = { type: "request_figure", revision: 3 };
const actions = {
  plan: { ...base, stage: "figure_plan", units: ["도입부", "첫 구간"], note: "첫 구간에 하나" },
  compose: {
    ...base,
    stage: "figure_compose",
    candidates: [candidate],
    look: "manual",
    feedback: "더 단순하게",
  },
  recompose: {
    ...base,
    stage: "figure_compose",
    candidates: [candidate],
    world: "세계",
    style: { look: "manual", accent: "노랑", base: "흰", labels: "짧게" },
    motifs: [{ name: "통행증", look: "카드" }],
    recompose: ["f1"],
  },
};
for (const look of [...Object.keys(FIGURE_LOOKS), "unknown"])
  actions[`draw ${look}`] = {
    ...base,
    stage: "figure",
    figureId: "f1",
    pass: "draw",
    candidates: [candidate],
    style: { look, accent: "노랑", base: "흰", labels: "짧게" },
    world: "세계",
    progress: { index: 1, total: 2 },
  };
// 국소 수정은 기준 파일 경로가 작업 폴더마다 달라 지시문만 대조한다
actions.fix = {
  ...actions["draw manual"],
  pass: "fix",
  candidates: [{ ...candidate, fix: "라벨" }],
  previous: [{ id: "f1", svg: '<svg viewBox="0 0 4 4"><rect width="4" height="4"/></svg>' }],
};

const prompts = Object.entries(actions).map(([name, action]) => {
  let prompt = buildPrompt(state, action).replaceAll(tools, "/tools");
  if (action.pass === "fix") prompt = prompt.slice(0, prompt.indexOf("\n<자료>\n"));
  return { name, action, digest: createHash("sha256").update(prompt).digest("hex") };
});
writeFileSync(
  new URL("./node-reference.json", import.meta.url),
  `${JSON.stringify({ state, prompts }, null, 2)}\n`,
);
