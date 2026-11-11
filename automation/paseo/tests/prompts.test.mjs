import assert from "node:assert/strict";
import test from "node:test";
import { stageOutputExamples, stageOutputSchemas } from "../../contracts/ai-output.mjs";
import { STAGES, transition } from "../../editorial/domain/index.mjs";
import { buildPrompt, resultEvent } from "../prompts.mjs";
import { BASE, LEVEL_RULES, MODE_RULES } from "../seasoning.mjs";

const outputs = {
  ...stageOutputExamples,
  diagnose: { ...stageOutputExamples.diagnose, primaryMode: "explain", readerLevel: "beginner" },
  outline: {
    ...stageOutputExamples.outline,
    sections: [{ title: "개념", mode: "explain", keyPoint: "핵심" }],
  },
};

const started = () =>
  transition(null, {
    id: "start",
    actor: "user",
    type: "start",
    articleId: "pilot-article",
    idea: "idea",
  }).state;
const job = (state, stage = "diagnose") => ({
  id: `job-${state.version}-${stage}`,
  state,
  action: { type: "request_ai", stage },
});

const artifacts = Object.fromEntries(
  ["diagnose", "research", "outline", "draft", "review"].map((stage) => [
    stage,
    { revision: 1, output: { text: `${stage}-content` } },
  ]),
);
const state = {
  source: "원문",
  idea: "독자 목표",
  artifacts,
  history: [{ artifacts }],
  feedback: "개념 혼동 수정",
};
const data = (prompt) => JSON.parse(prompt.split("\n자료:\n")[1]);
test("route sends current artifacts once without duplicated history", () => {
  const prompt = buildPrompt(state, { type: "request_route" });
  assert.equal(prompt.split("draft-content").length - 1, 1);
  assert.equal(data(prompt).baseline, undefined);
  assert.equal(data(prompt).feedback, state.feedback);
});
test("review keeps audience and outline with source, evidence and draft; excludes stale review", () => {
  const audience = { output: { reader: "입문자", intent: "이해", misconceptions: ["오해"] } };
  const current = { ...state, artifacts: { ...artifacts, audience } };
  const prompt = buildPrompt(current, { type: "request_ai", stage: "review" });
  const context = data(prompt);
  assert.deepEqual(Object.keys(context.artifacts), [
    "diagnose",
    "audience",
    "research",
    "outline",
    "draft",
  ]);
  assert.deepEqual(context.artifacts.audience, audience.output);
  assert.deepEqual(context.artifacts.outline, artifacts.outline.output);
  assert.equal(context.source, state.source);
  assert.equal(context.baseline, undefined);
  assert.match(prompt, /단정·수치·필수조건/);
  assert.match(prompt, /도구·파일·쉘·위임·발행 금지/);
});
test("redraft keeps previous draft exactly once and retained upstream evidence", () => {
  const revised = {
    ...state,
    artifacts: { diagnose: artifacts.diagnose, research: artifacts.research },
  };
  const prompt = buildPrompt(revised, { type: "request_ai", stage: "draft" });
  assert.equal(prompt.split("draft-content").length - 1, 1);
  assert.equal(data(prompt).baseline.text, "draft-content");
  assert.ok(data(prompt).artifacts.research);
  assert.equal(data(prompt).artifacts.review, undefined);
});

test("draft preserves article-specific length without a conflicting global target", () => {
  const state = { idea: "3500~5000자 글", artifacts: {}, history: [] };
  const prompt = buildPrompt(state, { type: "request_ai", stage: "draft" });
  assert.ok(prompt.includes(state.idea));
  assert.ok(prompt.includes("사용자 idea·feedback의 요구 준수"));
  assert.ok(!prompt.includes("1500~2500"));
});

test("review receives measured Unicode character count including whitespace", () => {
  const state = {
    artifacts: { draft: { output: { text: "가🙂\n A", changeSummary: "초고" } } },
    history: [],
  };
  const prompt = buildPrompt(state, { type: "request_ai", stage: "review" });
  const payload = JSON.parse(prompt.split("자료:\n")[1]);
  assert.equal(payload.draftCharacterCount, 5);
  assert.equal(payload.artifacts.draft.text, state.artifacts.draft.output.text);
  assert.ok(prompt.includes("추정 수치 금지"));
});

test("every stage accepts concrete output and includes its contract template in the prompt", () => {
  assert.deepEqual(Object.keys(stageOutputSchemas), STAGES);
  for (const stage of STAGES) {
    const output = outputs[stage];
    let current = started();
    while (current.stage !== stage) {
      current = transition(
        current,
        resultEvent(job(current, current.stage), JSON.stringify(outputs[current.stage])),
      ).state;
    }
    const event = resultEvent(job(current, stage), JSON.stringify(output));
    assert.deepEqual(event.output, output);
    assert.deepEqual(transition(current, event).state.artifacts[stage].output, output);
    const prompt = buildPrompt(current, { type: "request_ai", stage });
    assert.ok(prompt.includes(JSON.stringify(stageOutputExamples[stage])));
  }
});

test("AI structural validation rejects malformed fields and leaves job/state untouched", () => {
  for (const [stage, output] of [
    ["diagnose", { ...outputs.diagnose, sectionModes: [2] }],
    ["topic", { problem: {}, scope: "scope" }],
    ["audience", { reader: "reader" }],
    ["value", { outcome: "value", preserve: "text" }],
    ["research", { evidence: [{ claim: "claim", url: 42 }], uncertainties: [] }],
    ["research", { evidence: [null], uncertainties: [] }],
    ["outline", { sections: [{}], rationale: "reason" }],
    ["draft", { text: 1, changeSummary: "summary" }],
    ["review", { findings: [false], preservationCheck: "check" }],
    ["draft", null],
    ["draft", []],
  ]) {
    const pending = job(started(), stage);
    const before = structuredClone(pending);
    assert.throws(() => resultEvent(pending, JSON.stringify(output)));
    assert.deepEqual(pending, before);
  }
  const pending = job(started(), "draft");
  for (const message of [null, "{", "x".repeat(1024 * 1024 + 1)])
    assert.throws(() => resultEvent(pending, message));
});

test("pilot marker and unknown output/evidence fields survive validation and storage", () => {
  const current = started();
  const prompt = buildPrompt(current, { type: "request_ai", stage: "diagnose" }, { pilot: true });
  const output = JSON.parse(prompt.slice(prompt.indexOf("{")));
  const event = resultEvent(
    job(current, "diagnose"),
    `\`\`\`json\n${JSON.stringify(output)}\n\`\`\``,
  );
  assert.equal(event.output.marker, current.articleId);
  assert.equal(
    transition(current, event).state.artifacts.diagnose.output.marker,
    current.articleId,
  );
  const research = {
    evidence: [{ claim: "claim", url: "unverified", locator: { page: 3 } }],
    uncertainties: [],
    extra: { provider: true },
  };
  assert.deepEqual(
    resultEvent(job(current, "research"), JSON.stringify(research)).output,
    research,
  );
});

test("route validates structure while state machine owns stage and content semantics", () => {
  let presented = started();
  while (presented.status === "waiting_ai")
    presented = transition(
      presented,
      resultEvent(job(presented, presented.stage), JSON.stringify(outputs[presented.stage])),
    ).state;
  const current = transition(presented, {
    id: "feedback",
    actor: "user",
    type: "feedback",
    expectedVersion: presented.version,
    reviewedRevision: presented.revision,
    feedback: "표현 수정",
  }).state;
  const pending = { ...job(current), action: { type: "request_route" } };
  for (const output of [
    null,
    [],
    {},
    { target: "draft", reason: [] },
    { target: 1, reason: "reason" },
  ])
    assert.throws(() => resultEvent(pending, JSON.stringify(output)));
  const before = structuredClone(current);
  for (const output of [
    { target: "unknown", reason: "reason" },
    { target: "draft", reason: " " },
  ]) {
    const event = resultEvent(pending, JSON.stringify(output));
    assert.throws(() => transition(current, event));
    assert.deepEqual(current, before);
  }
  const event = resultEvent(pending, JSON.stringify({ target: "draft", reason: "표현 수정" }));
  assert.equal(transition(current, event).state.stage, "draft");
  assert.throws(
    () =>
      resultEvent(
        job(started(), "diagnose"),
        JSON.stringify({ ...outputs.diagnose, sectionModes: [] }),
      ),
    /sectionModes/,
  );
});

test("FLOW-002: every stage and route receive direction only when present", () => {
  const direction = { mode: "argue", readerLevel: "expert" };
  for (const action of [
    ...STAGES.map((stage) => ({ type: "request_ai", stage })),
    { type: "request_route" },
  ]) {
    assert.deepEqual(data(buildPrompt({ ...state, direction }, action)).direction, direction);
    assert.ok(!Object.hasOwn(data(buildPrompt(state, action)), "direction"));
  }
});

test("FLOW-002: diagnose preserves explicit directions and infers each auto or absent field", () => {
  const action = { type: "request_ai", stage: "diagnose" };
  const explicit = buildPrompt(
    { ...state, direction: { mode: "narrate", readerLevel: "expert" } },
    action,
  );
  assert.match(explicit, /지정값 narrate를 primaryMode로 그대로 반환/);
  assert.match(explicit, /지정값 expert를 readerLevel로 그대로 반환/);
  for (const direction of [undefined, { mode: "auto", readerLevel: "auto" }]) {
    const prompt = buildPrompt({ ...state, direction }, action);
    assert.match(prompt, /primaryMode를 판단/);
    assert.match(prompt, /readerLevel을 판단/);
  }
  const mixed = buildPrompt(
    { ...state, direction: { mode: "procedure", readerLevel: "auto" } },
    action,
  );
  assert.match(mixed, /지정값 procedure를 primaryMode로 그대로 반환/);
  assert.match(mixed, /readerLevel을 판단/);
});

test("FLOW-002: outline selects per-section modes without forcing explain cards on other modes", () => {
  const prompt = buildPrompt(state, { type: "request_ai", stage: "outline" });
  assert.match(prompt, /구간마다 title·mode·keyPoint/);
  assert.match(prompt, /기본은 주 mode 하나/);
  assert.match(prompt, /내용이 요구할 때만 구간별로 다른 mode/);
  assert.match(prompt, /explain 구간만 설계 카드 concrete·walkthrough·refute·checkQuestion/);
  assert.match(prompt, /숙련 독자는 concrete·walkthrough 선택/);
  assert.match(prompt, /다른 mode는 keyPoint만 필수/);
  assert.match(prompt, /사용자 direction.mode\(auto 제외\)를 우선/);
  assert.match(prompt, /사용자 direction.readerLevel\(auto 제외\)을 우선/);
});

test("FLOW-002: draft and review season only the primary and section modes at the chosen level", () => {
  const current = {
    ...state,
    direction: { mode: "procedure", readerLevel: "expert" },
    artifacts: {
      ...artifacts,
      diagnose: { output: { primaryMode: "explain", readerLevel: "beginner" } },
      outline: { output: { sections: [{ title: "경험", mode: "narrate", keyPoint: "핵심" }] } },
    },
  };
  for (const stage of ["draft", "review"]) {
    const prompt = buildPrompt(current, { type: "request_ai", stage });
    for (const rule of [
      ...BASE[stage],
      ...MODE_RULES.procedure[stage],
      ...MODE_RULES.narrate[stage],
      ...LEVEL_RULES.expert,
    ])
      assert.ok(prompt.includes(rule));
    for (const rule of [
      ...MODE_RULES.explain[stage],
      ...MODE_RULES.argue[stage],
      ...LEVEL_RULES.beginner,
    ])
      assert.ok(!prompt.includes(rule));
    assert.match(prompt, /도구·파일·쉘·위임·발행 금지/);
  }
});

test("FLOW-002: legacy directionless string sections still build draft and review with base rules", () => {
  const legacy = { ...state, artifacts: { outline: { output: { sections: ["옛 구간"] } } } };
  for (const stage of ["draft", "review"]) {
    const prompt = buildPrompt(legacy, { type: "request_ai", stage });
    for (const rule of BASE[stage]) assert.ok(prompt.includes(rule));
    assert.doesNotMatch(prompt, /\[(?:explain|procedure|argue|narrate|독자) /);
    assert.ok(!Object.hasOwn(data(prompt), "direction"));
  }
});
