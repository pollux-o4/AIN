import assert from "node:assert/strict";
import test from "node:test";
import { stageTurns } from "../ui/tracking/stageTurns.ts";

const rec = (revision, stage, kind, extra = {}) => ({
  key: `${revision}-${stage}-${kind}-${extra.n ?? 0}`,
  revision,
  stage,
  kind,
  steps: [],
  ...extra,
});

test("STAGE-LOG: 현재 결과의 출처 회차를 기본으로 · 미실행 회차는 유지로 채운다", () => {
  const records = [
    rec(1, "audience", "ai_requested"),
    rec(1, "audience", "ai_completed"),
    rec(3, "audience", "ai_completed", { n: 1 }),
    rec(3, "audience", "ai_completed", { n: 2 }),
    rec(4, "draft", "ai_completed"),
  ];
  const journey = [{ revision: 3, request: "독자 수준 낮춰줘" }];
  const { turns, source, slots } = stageTurns(records, journey, "audience", 5);
  assert.deepEqual(
    turns.map((t) => [t.revision, t.attempts.length]),
    [
      [1, 1],
      [3, 2],
    ],
  );
  assert.equal(source.revision, 3);
  assert.equal(source.result.key, "3-audience-ai_completed-2");
  assert.equal(source.request, "독자 수준 낮춰줘");
  assert.deepEqual(
    slots.map((s) => [s.revision, Boolean(s.turn)]),
    [
      [1, true],
      [2, false],
      [3, true],
      [4, false],
      [5, false],
    ],
  );
});

test("STAGE-LOG: 실행이 없으면 빈 결과", () => {
  const { turns, source, slots } = stageTurns([], [], "topic", 2);
  assert.deepEqual([turns, source, slots], [[], null, []]);
});
