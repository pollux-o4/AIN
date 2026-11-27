// 검증: TIME-001 검증 시간 예산
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";
import { PHASES, TOTAL_SECONDS } from "./time-budget.mjs";

const LIVE_TASKS = ["ai:pilot", "ai:test:contract", "ai:e2e:article", "ai:eval"];
const LIVE_ENTRIES = ["pilot", "article-e2e", "contract-e2e", "eval"];

test("TIME-001: 단계별 예산의 합이 전체 상한 안이다", () => {
  // 같은 단계의 작업은 나란히 돌므로 단계 시간은 가장 긴 작업의 예산
  const worst = PHASES.reduce(
    (sum, phase) => sum + Math.max(...phase.tasks.map((entry) => entry.seconds)),
    0,
  );
  assert.ok(worst <= TOTAL_SECONDS, `단계 예산 합 ${worst}초가 상한 ${TOTAL_SECONDS}초를 넘음`);
  assert.equal(TOTAL_SECONDS, 300);
});

test("TIME-001: 기본 검증은 Go 흐름과 PC·모바일 클라이언트를 검사한다", () => {
  const tasks = PHASES.flatMap((phase) => phase.tasks.map(({ task }) => task));
  assert.ok(tasks.includes("go:check"));
  assert.ok(tasks.includes("go:client-check"));
  assert.ok(!tasks.some((task) => task === "test:n8n:runtime" || task === "test:flow"));
});

test("TIME-001: 실제 모델 작업은 검증에도 다른 작업의 의존에도 묶이지 않는다", async () => {
  const budgeted = PHASES.flatMap((phase) => phase.tasks.map((entry) => entry.task));
  assert.deepEqual(
    budgeted.filter((task) => task.startsWith("ai:")),
    [],
  );
  const config = `${await readFile("mise.toml", "utf8")}\n${await readFile("mise-tasks/test.toml", "utf8")}`;
  // depends·작업 연결(task = …)에 실제 모델 작업 이름이 나오지 않는다
  const linked = config
    .split("\n")
    .filter((line) => /^\s*(depends|run)\s*=/.test(line) && /task\s*=|depends/.test(line));
  for (const task of LIVE_TASKS)
    assert.ok(!linked.some((line) => line.includes(`"${task}"`)), `${task}가 다른 작업에 묶임`);
});

test("TIME-001: 실제 모델 진입점은 터미널이 아닌 실행을 호출 전에 거부한다", async () => {
  const { AIN_LIVE: _unset, ...env } = process.env;
  for (const entry of LIVE_ENTRIES) {
    const result = await promisify(execFile)("node", [`automation/paseo/${entry}.mjs`], {
      env,
      timeout: 20000,
    }).then(
      () => ({ code: 0, stderr: "" }),
      (error) => ({ code: error.code, stderr: String(error.stderr) }),
    );
    assert.equal(result.code, 2, `${entry}: 허락 없이 시작됨`);
    assert.match(result.stderr, /자동으로 실행하지 않습니다/);
  }
});
