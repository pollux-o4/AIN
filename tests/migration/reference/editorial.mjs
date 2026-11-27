import { nextAction, transition } from "../../../automation/editorial/domain/index.mjs";

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
  output: {
    purpose: "경험과 판단의 공유",
    audience: "동료 개발자",
    sectionModes: ["experience", "explanation"],
    preserveVoice: "일인칭",
    strategy: "경험에서 판단을 설명한다",
  },
};
record("wrong stage", initial, { ...complete, stage: "review" });
record("stale version", initial, { ...complete, expectedVersion: initial.version - 1 });
record("first completion", initial, complete);
process.stdout.write(JSON.stringify(cases, null, 2) + "\n");
