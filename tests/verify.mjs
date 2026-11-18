// 전체 검증 실행기: 단계별로 돌리고 작업마다 걸린 시간을 예산과 대조한다 · TIME-001
// 실패한 작업이 있거나 예산을 넘으면 0이 아닌 코드로 끝난다 · `--force`는 캐시를 무시하고 전부 다시 잰다
import { spawn } from "node:child_process";
import { PHASES, TOTAL_SECONDS } from "./time-budget.mjs";

const force = process.argv.includes("--force");

function run(task) {
  const started = Date.now();
  return new Promise((done) => {
    const child = spawn("mise", ["run", ...(force ? ["--force"] : []), task], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) =>
      done({ task, ok: code === 0, seconds: (Date.now() - started) / 1000, output }),
    );
  });
}

const started = Date.now();
const rows = [];
let failed = false;
for (const phase of PHASES) {
  if (failed) break;
  const results = await Promise.all(phase.tasks.map(({ task }) => run(task)));
  for (const result of results) {
    const { seconds: budget } = phase.tasks.find((entry) => entry.task === result.task);
    const over = result.seconds > budget;
    rows.push({ ...result, budget, over });
    if (!result.ok) {
      failed = true;
      // 실패한 작업의 출력 끝부분만 보여 준다
      console.error(
        `\n── ${result.task} 실패 ──\n${result.output.split("\n").slice(-40).join("\n")}`,
      );
    }
  }
}
const total = (Date.now() - started) / 1000;
const overBudget = rows.filter((row) => row.over);
for (const row of rows)
  console.log(
    `${row.ok ? (row.over ? "느림" : "통과") : "실패"}  ${row.task.padEnd(18)} ${row.seconds.toFixed(1).padStart(6)}초 / ${row.budget}초`,
  );
console.log(`전체 ${total.toFixed(1)}초 / ${TOTAL_SECONDS}초`);
if (overBudget.length || total > TOTAL_SECONDS) {
  console.error(
    `시간 예산 초과(TIME-001): ${overBudget.map((row) => row.task).join(", ") || "전체"} · 예산을 올리기 전에 느려진 원인을 걷어낸다`,
  );
  failed = true;
}
process.exitCode = failed ? 1 : 0;
