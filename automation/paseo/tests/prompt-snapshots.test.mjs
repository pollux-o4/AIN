// 지시문 모아보기: 과업별 지시 전문을 한 파일에 고정해 문구 변경을 전후 비교로 검토한다 · ADR-0013
// 갱신: node --test --test-update-snapshots automation/paseo/tests/prompt-snapshots.test.mjs

import test from "node:test";
import { fileURLToPath } from "node:url";
import { FIGURE_FIX_PASS, FIGURE_PASSES } from "../../contracts/figure.mjs";
import { STAGES } from "../../editorial/domain/index.mjs";
import { buildPrompt } from "../prompts/index.mjs";

// 자료 구역은 가짜 상태라 검토 대상이 아니므로 지시 부분만 남긴다
// 저장소 위치는 기계마다 다르므로 <저장소>로 바꿔 고정한다
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const instructions = (prompt) =>
  prompt.slice(0, prompt.indexOf("\n<자료>")).trimEnd().replaceAll(REPO, "<저장소>/");

const artifacts = Object.fromEntries(
  STAGES.map((stage) => [stage, { revision: 1, output: { text: `${stage}-content` } }]),
);
const state = { source: "원문", idea: "독자 목표", artifacts, history: [{ artifacts }] };

const TASKS = [
  ...STAGES.map((stage) => [`단계 ${stage}`, { type: "request_ai", stage }]),
  ["수정 경로 route", { type: "request_route" }],
  ["시각자료 figure_plan", { type: "request_figure", stage: "figure_plan" }],
  ["시각자료 figure_compose", { type: "request_figure", stage: "figure_compose" }],
  ...[...FIGURE_PASSES, FIGURE_FIX_PASS].map((pass) => [
    `시각자료 figure · ${pass}`,
    { type: "request_figure", stage: "figure", pass, figureId: "f1" },
  ]),
  // 구성이 고른 스타일이 anatomy가 아닐 때 · ADR-0027
  [
    "시각자료 figure · draw · sketchnote",
    { type: "request_figure", stage: "figure", figureId: "f1", style: { look: "sketchnote" } },
  ],
];

for (const [name, action] of TASKS) {
  test(name, (t) => {
    t.assert.snapshot(instructions(buildPrompt(state, action)), { serializers: [(v) => v] });
  });
}
