// 검증: ADR-0007 요구사항 가드
import assert from "node:assert/strict";
import test from "node:test";
import { nextAction, requirements, STAGES, transition } from "../domain/index.mjs";
import { parseLength } from "../domain/legacy-requirements.mjs";
import { diagnoseFor, lengthChanges } from "./requirement-fixtures.mjs";
import { STORY } from "./story-card.mjs";

test("자연어 분량 표현을 범위로 읽는다", () => {
  assert.deepEqual(parseLength("3500~5000자로"), { min: 3500, max: 5000 });
  assert.deepEqual(parseLength("4,500자 안팎"), { min: 4050, max: 4950 });
  assert.deepEqual(parseLength("4500자(±10%)"), { min: 4050, max: 4950 });
  assert.deepEqual(parseLength("2000자 이내"), { min: 0, max: 2000 });
  assert.deepEqual(parseLength("3000자 이상"), { min: 3000, max: null });
  assert.equal(parseLength("3절 비교표"), null);
});

// draft: 구간마다 draftSize자(첫 구간·한 번에 쓴 원고는 글 제목 줄 포함) · outline: 분량 요구가 있으면 2구간 예산(요구 중앙값 절반씩, ADR-0009 예산 검증 충족)
const output = (state, draftSize) =>
  state.stage === "draft"
    ? { text: draftText(state, draftSize), changeSummary: "요약" }
    : state.stage === "outline"
      ? outlineFor(state)
      : state.stage === "diagnose"
        ? diagnoseFor(state.idea, fill("diagnose"))
        : fill(state.stage);
function draftText(state, size) {
  const lead = (nextAction(state).section?.index ?? 0) === 0 ? "# 제목\n" : "";
  return lead + "가".repeat(Math.max(0, size - lead.length));
}
function outlineFor(state) {
  const length = requirements(state).length;
  if (!length) return fill("outline");
  const half = Math.round((length.min + (length.max ?? length.min * 1.2)) / 4);
  const section = (title) => ({ title, mode: "explain", keyPoint: "k", budget: half, ...STORY });
  return { sections: [section("앞"), section("뒤")], rationale: "r" };
}
function fill(stage) {
  const base = {
    diagnose: {
      purpose: "p",
      audience: "a",
      sectionModes: ["explain"],
      preserveVoice: "v",
      strategy: "s",
    },
    topic: { problem: "p", scope: "s" },
    audience: { reader: "r", intent: "i" },
    value: { outcome: "o", preserve: ["p"] },
    research: { evidence: [], uncertainties: ["u"] },
    outline: { sections: ["s"], rationale: "r" },
    review: { findings: [], preservationCheck: "ok" },
  };
  return base[stage];
}

let seq = 0;
function step(state, type, extra = {}) {
  return transition(state, {
    id: `e${seq++}`,
    actor: ["start", "feedback", "satisfy", "approve_brief"].includes(type) ? "user" : "adapter",
    type,
    expectedVersion: state?.version,
    ...extra,
  }).state;
}
// 한 회차만 진행 · 가드가 새 회차를 열면 멈춤
function runStages(state, draftSize) {
  const revision = state.revision;
  while (state.status === "waiting_ai" && state.revision === revision) {
    const section = nextAction(state).section;
    state = step(state, "complete", {
      stage: state.stage,
      revision: state.revision,
      output: output(state, draftSize),
      ...(section ? { section: section.index } : {}),
    });
  }
  return state;
}

// 구간별 초고는 구간 한도가 전체 분량을 지킨다(sections.test) · 가드는 구성 뒤에 분량 요구가 바뀐 경우의 안전망
test("구성 뒤에 생긴 분량 요구를 초고가 못 맞추면 구성부터 자동 재작성해 예산을 다시 잡는다", () => {
  let s = step(null, "start", { articleId: "a", idea: "아키텍처 설명" });
  s = runStages(s, 2800);
  assert.equal(s.status, "awaiting_user");
  s = step(s, "feedback", {
    reviewedRevision: s.revision,
    feedback: "4500자 안팎으로 늘려 주세요",
    briefPreapproved: true,
  });
  s = step(s, "route", {
    revision: s.revision,
    target: "draft",
    reason: "분량 보강",
    brief: { requirementChanges: lengthChanges("4500자 안팎으로 늘려 주세요") },
  });
  assert.deepEqual(requirements(s), { length: { min: 4050, max: 4950 } });
  // 예산 없는 이전 구성 그대로 한 번에 다시 쓴 초고가 요구에 못 미침
  s = runStages(s, 2800);
  assert.equal(s.stage, "outline");
  assert.equal(s.feedbackSource, "auto");
  assert.match(s.feedback, /2800자 · 요구 4050~4950자/);
  assert.equal(s.artifacts.value.reusedFromRevision, s.revision - 1);
  // 새 구성은 구간 예산을 갖고, 구간 한도 안의 초고는 전체 요구를 충족
  s = runStages(s, 2300);
  assert.equal(s.status, "awaiting_user");
  assert.equal(s.unmet, undefined);
  s = step(s, "satisfy", { reviewedRevision: s.revision });
  assert.equal(s.status, "satisfied");
});

test("자동 보정 지시문 수치는 요구로 다시 읽지 않고, 사람 피드백은 횟수를 초기화한다", () => {
  let s = step(null, "start", {
    articleId: "b",
    idea: "설명",
    direction: { mode: "auto", readerLevel: "auto", targetLength: { min: 1000, max: 2000 } },
  });
  s = runStages(s, 750);
  assert.equal(s.status, "awaiting_user");
  assert.equal(s.unmet, undefined);
  s = step(s, "feedback", { reviewedRevision: s.revision, feedback: "사례 추가" });
  assert.equal(s.autoCorrections, 0);
  assert.equal(s.feedbackSource, "person");
  assert.equal(STAGES.at(-1), "review");
});

test("ADR-0008 검토 합격 판정이 revise면 지정 단계부터 다시, 상한 후 사람에게", () => {
  let s = step(null, "start", { articleId: "c", idea: "설명" });
  const revise = (state) => {
    const revision = state.revision;
    while (state.status === "waiting_ai" && state.revision === revision)
      state = step(state, "complete", {
        stage: state.stage,
        revision: state.revision,
        output:
          state.stage === "review"
            ? {
                findings: ["2절 개념 두 개"],
                preservationCheck: "ok",
                verdict: "revise",
                reviseFrom: "outline",
                unmetCriteria: ["절마다 개념 하나"],
              }
            : output(state, 2),
      });
    return state;
  };
  s = revise(s);
  assert.equal(s.stage, "outline");
  assert.match(s.feedback, /검토 판정 미충족: 절마다 개념 하나/);
  s = revise(revise(s));
  assert.equal(s.status, "awaiting_user");
  assert.equal(s.unmet[0].kind, "review");
  s = step(s, "satisfy", { reviewedRevision: s.revision });
  assert.equal(s.status, "satisfied", "검토 판정(주관) 미충족은 사람이 판단해 승인 가능");
});

// 검증: ADR-0016 요구사항 목록 · 최신 사람 지시가 이기고, 해제(lift)는 의뢰 값까지 푼다
test("ADR-0016 의뢰 분량은 피드백 해석이 풀 수 있고, 승인 전 제안은 장부에 들지 않는다", () => {
  let s = step(null, "start", {
    articleId: "ledger",
    idea: "설명",
    direction: { mode: "explain", readerLevel: "auto", targetLength: { min: 3000, max: 4000 } },
  });
  assert.deepEqual(requirements(s), { mode: "explain", length: { min: 3000, max: 4000 } });
  s = runStages(s, 1700);
  assert.equal(s.status, "awaiting_user");
  s = step(s, "feedback", { reviewedRevision: s.revision, feedback: "글자 수는 상관없어요" });
  const lift = { kind: "length", op: "lift", quote: "글자 수는 상관없어요" };
  s = step(s, "route", {
    revision: s.revision,
    target: "draft",
    reason: "분량 제한 해제",
    brief: {
      requirementChanges: [lift, { kind: "length", op: "set", value: "깨진 값", quote: "x" }],
    },
  });
  assert.equal(s.status, "awaiting_brief");
  assert.deepEqual(requirements(s).length, { min: 3000, max: 4000 }, "승인 전에는 그대로");
  s = step(s, "approve_brief", { reviewedRevision: s.revision });
  assert.deepEqual(requirements(s), { mode: "explain" }, "형식이 틀린 변경만 버리고 해제는 반영");
  assert.equal(s.requirementLog.at(-1).source, "feedback");
});

test("ADR-0016 장부 없는 이전 글은 이전 규칙으로 한 번 옮겨진다", () => {
  let s = step(null, "start", { articleId: "old", idea: "설명 4500자 안팎" });
  delete s.requirementLog;
  assert.deepEqual(requirements(s), { length: { min: 4050, max: 4950 } });
  s = step(s, "complete", { stage: s.stage, revision: s.revision, output: fill("diagnose") });
  assert.equal(s.requirementLog.length, 1);
  assert.equal(s.requirementLog[0].changes[0].quote, "이전 기록");
});
