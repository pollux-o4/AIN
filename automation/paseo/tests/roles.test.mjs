import assert from "node:assert/strict";
import test from "node:test";
import { STAGES } from "../../editorial/domain/index.mjs";
import { deltaContext, roleOf } from "../roles.mjs";

test("roles: 모든 단계·경로에 담당이 있고 작성과 검토는 다른 담당", () => {
  for (const stage of STAGES) assert.ok(roleOf({ type: "request_ai", stage }), stage);
  assert.equal(roleOf({ type: "request_route" }), "planner");
  assert.notEqual(
    roleOf({ type: "request_ai", stage: "draft" }),
    roleOf({ type: "request_ai", stage: "review" }),
  );
});

test("roles: 처음엔 전체, 이후엔 새·바뀐 항목만 전달", () => {
  const first = { source: "s", idea: "i", artifacts: { diagnose: { a: 1 } } };
  const one = deltaContext(first);
  assert.deepEqual(one.delta, first);
  assert.deepEqual(one.omitted, []);
  const second = { ...first, artifacts: { diagnose: { a: 1 }, topic: { b: 2 } } };
  const two = deltaContext(second, one.delivered);
  assert.deepEqual(two.delta, { artifacts: { topic: { b: 2 } } });
  assert.deepEqual(two.omitted.sort(), ["artifacts.diagnose", "idea", "source"]);
  const revised = {
    ...second,
    feedback: "더 짧게",
    artifacts: { diagnose: { a: 9 }, topic: { b: 2 } },
  };
  const three = deltaContext(revised, two.delivered);
  assert.deepEqual(three.delta, { feedback: "더 짧게", artifacts: { diagnose: { a: 9 } } });
});
