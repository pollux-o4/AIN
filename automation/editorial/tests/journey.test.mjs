import assert from "node:assert/strict";
import test from "node:test";
import { writingJourney } from "../service/journey.mjs";

const artifact = (revision, output) => ({ revision, output });
function snapshot(revision) {
  return {
    revision,
    artifacts: {
      audience: artifact(revision, { reader: "입문자", intent: "사례로 이해" }),
      value: artifact(revision, { outcome: "책임 분리 판단", preserve: [] }),
      topic: artifact(revision, { problem: "주문과 결제", scope: "쇼핑몰" }),
      outline: artifact(revision, { sections: ["주문", "결제"], rationale: "책임 순서" }),
      draft: artifact(revision, {
        text: "실제 초안",
        changeSummary: revision === 1 ? "처음 작성" : "결제 사례 보강",
      }),
      review: artifact(revision, { findings: ["수치 확인 필요"], preservationCheck: "핵심 유지" }),
      research: artifact(revision, {
        evidence: [],
        uncertainties: ["수치 확인 필요", "출처 추가 확인"],
      }),
    },
  };
}
test("HISTORY-001: show editorial decisions, requested changes and remaining checks without repeating unchanged choices", () => {
  const previous = { ...snapshot(1), feedback: "결제 예시 보강" };
  const state = { ...snapshot(2), history: [previous] };
  const journey = writingJourney(state, []);
  assert.equal(journey[0].direction.length, 3);
  assert.equal(journey[0].request, null);
  assert.equal(journey[1].direction.length, 0);
  assert.equal(journey[1].request, "결제 예시 보강");
  assert.equal(journey[1].summary, "결제 사례 보강");
  assert.deepEqual(journey[1].findings, ["수치 확인 필요", "출처 추가 확인"]);
  state.artifacts.audience.output.reader = "실무자";
  assert.deepEqual(
    writingJourney(state, [])[1].direction.map((choice) => choice.label),
    ["독자"],
  );
});
test("HISTORY-001: missing and wrong-revision evidence never become invented decisions", () => {
  const state = { revision: 2, artifacts: snapshot(1).artifacts, history: [] };
  const [entry] = writingJourney(state, []);
  assert.equal(entry.summary, null);
  assert.deepEqual(entry.direction, []);
  assert.deepEqual(entry.findings, []);
  assert.equal(entry.hasDraft, true);
  assert.deepEqual(writingJourney({}, []), []);
});

test("HISTORY-001: object and string outline sections display titles and compare across formats", () => {
  const previous = snapshot(1);
  const state = { ...snapshot(2), history: [previous] };
  state.artifacts.outline.output.sections = [
    { title: "주문", mode: "explain", keyPoint: "주문 책임" },
    "결제",
  ];
  assert.deepEqual(writingJourney(state, [])[1].direction, []);
  state.artifacts.outline.output.sections[1] = {
    title: "결제 순서",
    mode: "procedure",
    keyPoint: "확인 과정",
  };
  assert.deepEqual(writingJourney(state, [])[1].direction, [
    { label: "구성", text: "주문 → 결제 순서", reason: "책임 순서" },
  ]);
});
