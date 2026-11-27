import { nextAction, transition } from "../../../automation/editorial/domain/index.mjs";

const outputs = {
  diagnose: {
    purpose: "経験と判断の共有",
    audience: "同じ課題の開発者",
    sectionModes: ["experience", "explanation"],
    preserveVoice: "一人称の迷いを保持",
    strategy: "経験→判断→結果; 分類表を強制しない",
  },
  topic: { problem: "接続障害", scope: "原因の切り分け" },
  audience: { reader: "運用担当", intent: "復旧したい" },
  value: { outcome: "判断を再現", preserve: ["失敗条件"] },
  research: { evidence: [], uncertainties: ["ログ未確認"] },
  outline: { sections: ["体験", "判断", "結果"], rationale: "時間順で因果を説明" },
  draft: { text: "# 体験\n\n実体験の本文。", changeSummary: "因果関係を補足" },
  review: { findings: ["出典未確認を表示"], preservationCheck: "条件・語り口を保持" },
};

const cases = [];
function record(name, before, event) {
  try {
    const { state } = transition(before, event);
    cases.push({ name, before, event, state, next: nextAction(state) });
    return state;
  } catch (error) {
    cases.push({ name, before, event, error: error.message });
  }
}

const start = {
  id: "request-1",
  actor: "user",
  type: "start",
  articleId: "migration-example",
  idea: "접속 장애에서 배운 점",
  source: "합성 원문",
};

const initial = record("start", null, start);
if (!initial) throw new Error("Reference start failed");
record("duplicate", initial, start);
const complete = {
  id: "result-1",
  actor: "adapter",
  type: "complete",
  expectedVersion: initial.version,
  revision: initial.revision,
  stage: initial.stage,
  output: outputs[initial.stage],
};
record("wrong stage", initial, { ...complete, stage: "review" });
record("stale version", initial, { ...complete, expectedVersion: initial.version - 1 });
let state = record("first completion", initial, complete);
const stages = new Set([initial.stage]);
while (state?.status === "waiting_ai") {
  if (stages.has(state.stage) || !outputs[state.stage]) {
    throw new Error(`Unexpected reference stage: ${state.stage}`);
  }
  stages.add(state.stage);
  state = record(`complete ${state.stage}`, state, {
    ...complete,
    id: `result-${stages.size}`,
    expectedVersion: state.version,
    revision: state.revision,
    stage: state.stage,
    output: outputs[state.stage],
  });
}
if (state?.status !== "awaiting_user") throw new Error("Reference writing flow failed");
process.stdout.write(`${JSON.stringify(cases, null, 2)}\n`);
