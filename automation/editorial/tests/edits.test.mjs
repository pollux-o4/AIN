// 검증: ADR-0018 문장 편집·교열 수정은 변경 표시로 결과를 내고 코드가 원고에 적용한다
import assert from "node:assert/strict";
import test from "node:test";
import { nextAction, STAGES, transition } from "../domain/index.mjs";
import { STORY } from "./story-card.mjs";

const TEXT =
  "# 정렬 입문\n\n카드를 늘어놓습니다. 기준을 정합니다.\n\n## 정렬\n\n작은 수부터 세웁니다. 그렇게 줄을 세웁니다.";
const OUTPUT = {
  diagnose: {
    purpose: "p",
    audience: "a",
    sectionModes: ["explain"],
    preserveVoice: "v",
    strategy: "s",
    requirementChanges: [],
  },
  topic: { problem: "p", scope: "s" },
  audience: { reader: "r", intent: "i" },
  value: { outcome: "o", preserve: ["p"] },
  research: { evidence: [], uncertainties: ["u"] },
  outline: { sections: ["s"], rationale: "r" },
  draft: { text: TEXT, changeSummary: "초고" },
  review: { findings: [], preservationCheck: "ok" },
};
let seq = 0;
const step = (state, type, extra = {}) =>
  transition(state, {
    id: `edit-${seq++}`,
    actor: ["start", "feedback", "approve_brief"].includes(type) ? "user" : "adapter",
    type,
    expectedVersion: state?.version,
    ...extra,
  }).state;
const complete = (state, output, extra = {}) =>
  step(state, "complete", { stage: state.stage, revision: state.revision, output, ...extra });

// 첫 원고 → 사람 피드백 → 편집 메모(수준 level) 승인 → 초고 대기
function revising(level, outputs = OUTPUT) {
  let state = step(null, "start", { articleId: "edit-article", idea: "정렬 입문" });
  while (state.status === "waiting_ai") state = complete(state, outputs[state.stage]);
  state = step(state, "feedback", { reviewedRevision: 1, feedback: "끝 문장 반복을 고쳐 주세요" });
  state = step(state, "route", {
    revision: 2,
    target: "draft",
    reason: "끝 문장 반복 정리",
    brief: { level, priorities: ["끝 문장 반복"] },
  });
  return step(state, "approve_brief", { reviewedRevision: 2 });
}

test("ADR-0018 line 수정: 변경 표시만 적용하고 표시하지 않은 글자는 그대로", () => {
  let state = revising("line");
  assert.deepEqual(
    [nextAction(state).stage, nextAction(state).mode, nextAction(state).section],
    ["draft", "edit", undefined],
  );
  const edits = [
    { find: "그렇게 줄을 세웁니다.", replace: "이 순서가 곧 정렬입니다." },
    { find: "카드를 늘어놓습니다. ", replace: "카드를 늘어놓습니다.\n\n" },
  ];
  state = complete(state, { edits, changeSummary: "끝 문장 교체·문단 나눔" }, { mode: "edit" });
  const draft = state.artifacts.draft.output;
  assert.equal(
    draft.text,
    "# 정렬 입문\n\n카드를 늘어놓습니다.\n\n기준을 정합니다.\n\n## 정렬\n\n작은 수부터 세웁니다. 이 순서가 곧 정렬입니다.",
  );
  assert.deepEqual(draft.edits, edits);
  assert.equal(state.stage, "review");
});

test("ADR-0018 표시가 원고와 어긋나면 반려하고 사유를 다음 요청에 싣는다", () => {
  let state = revising("copy");
  const bad = (find) => ({ edits: [{ find, replace: "x" }], changeSummary: "s" });
  state = complete(state, bad("없는 문장"), { mode: "edit" });
  assert.equal(state.stage, "draft");
  assert.match(nextAction(state).retryNote, /1번 find가 baseline에 없다/);
  state = complete(state, bad("세웁니다."), { mode: "edit" });
  assert.match(nextAction(state).retryNote, /여러 번 나온다/);
  // 다시 쓰기 상한을 넘기면 실패로 멈추고 원고는 바뀌지 않는다
  for (let i = 0; i < 3 && state.status !== "failed"; i += 1)
    state = complete(state, bad("없는 문장"), { mode: "edit" });
  assert.equal(state.status, "failed");
  assert.equal(state.artifacts.draft, undefined);
});

test("ADR-0018 구조 편집은 기존대로 원고를 새로 쓴다", () => {
  const state = revising("developmental");
  assert.notEqual(state.stage, "draft");
  assert.ok(STAGES.indexOf(state.stage) <= STAGES.indexOf("outline"));
});

test("ADR-0018 카드에서 온 문장을 표시로 바꾸면 구간 카드도 같은 값으로 바뀐다", () => {
  const card = { title: "정렬", mode: "explain", keyPoint: "k", ...STORY };
  const outline = {
    title: "정렬 입문",
    sections: [{ ...card, underline: "그렇게 줄을 세웁니다." }],
    rationale: "r",
  };
  let state = revising("line", { ...OUTPUT, outline });
  const edits = [
    { find: "# 정렬 입문\n", replace: "# 작은 수부터 줄 세우기\n" },
    { find: "그렇게 줄을 세웁니다.", replace: "이 순서가 곧 정렬입니다." },
  ];
  state = complete(state, { edits, changeSummary: "제목·밑줄 문장 교체" }, { mode: "edit" });
  const synced = state.artifacts.outline.output;
  assert.equal(synced.title, "작은 수부터 줄 세우기", "표시가 카드 문장보다 넓어도 바뀐 값만 옮김");
  assert.equal(synced.sections[0].underline, "이 순서가 곧 정렬입니다.");
  assert.equal(synced.sections[0].hook, card.hook, "바꾸지 않은 항목은 그대로");
  assert.equal(state.history.at(-1).artifacts.outline.output.title, "정렬 입문", "이력은 보존");
});
