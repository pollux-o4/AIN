// 반복 평가: 같은 글감을 실제 기본 모델로 여러 번 돌려 기준별 통과율(멱등성)과 비용 분포를 낸다
// 한 번의 통과는 운일 수 있다 · 프롬프트를 바꾸면 바꾸기 전후를 이 표로 비교한다 · ADR-0013
// 비용: 글감 × 반복 × (필수 8단계 + 구간·다시 쓰기) 호출 · 명시적으로 실행할 때만
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { runLiveVerification } from "./contract-e2e.mjs";
import { LIVE_CASES, liveCase } from "./live/cases.mjs";
import { requireLiveConsent } from "./live/consent.mjs";
import { GRADERS, summarize } from "./live/grade.mjs";

// 격리 n8n은 실행마다 포트 둘(본체·작업 실행기 = 포트+1)을 쓴다 · 나란히 도는 실행은 PORT_STEP씩 띄운다
const BASE_PORT = 5740; // 계약 검증(5738)과 겹치지 않는 구간
const PORT_STEP = 10;

const { values } = parseArgs({
  options: {
    cases: { type: "string", default: LIVE_CASES.map((c) => c.id).join(",") },
    // 기본은 글감마다 1회 · 멱등성을 볼 때만 --trials를 올린다(호출 수가 그만큼 는다)
    trials: { type: "string", default: "1" },
    parallel: { type: "string", default: "2" },
  },
});
const cases = values.cases.split(",").map((id) => liveCase(id.trim()));
const trials = Number(values.trials);
const parallel = Number(values.parallel);
if (!(Number.isInteger(trials) && trials > 0 && Number.isInteger(parallel) && parallel > 0))
  throw new Error("--trials, --parallel은 양의 정수");

async function trial(live, port) {
  try {
    const report = await runLiveVerification({ pilot: false, live, port, quiet: true });
    return {
      case: live.id,
      quality: report.quality,
      calls: report.articleCalls,
      durationMs: report.durationMs,
      outputTokens: report.usage?.total?.outputTokens,
      directory: report.directory,
    };
  } catch (error) {
    // 멈춘 까닭이 보고서에 있으면 그것을(예: 제공자 오류·구간 한도 반복 초과), 없으면 실패 단계만
    return {
      case: live.id,
      failure: String(error.report?.stopped ?? error.message).slice(0, 300),
      directory: error.report?.directory,
    };
  }
}

requireLiveConsent(`글 ${cases.length * trials}편 · 편당 호출 10회 안팎`);

// 연결 확인 1회가 통과해야 글 실행을 시작한다(실패한 연결에 글 호출을 쓰지 않음)
await runLiveVerification({ article: false, quiet: true });

const queue = cases.flatMap((live) => Array.from({ length: trials }, () => live));
const done = [];
await Promise.all(
  Array.from({ length: Math.min(parallel, queue.length) }, async (_unused, slot) => {
    for (let live = queue.shift(); live; live = queue.shift()) {
      const result = await trial(live, BASE_PORT + slot * PORT_STEP);
      done.push(result);
      console.error(
        `[${done.length}/${cases.length * trials}] ${live.id} ${result.failure ? `실패: ${result.failure}` : `${result.calls}회 · ${Math.round(result.durationMs / 1000)}초`}`,
      );
    }
  }),
);

const summary = Object.fromEntries(
  cases.map((live) => [live.id, summarize(done.filter((t) => t.case === live.id))]),
);
const root = resolve(".local", `eval-${new Date().toISOString().replace(/[:.]/g, "-")}`);
await mkdir(root, { recursive: true, mode: 0o700 });
await writeFile(
  join(root, "summary.json"),
  JSON.stringify(
    {
      graders: GRADERS.map(({ id, basis, hard, ask }) => ({ id, basis, hard, ask })),
      summary,
      trials: done,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(JSON.stringify({ directory: root, summary }, null, 1));
// 멱등성 기준: 모든 글감이 모든 반복에서 필수 기준을 통과
if (!Object.values(summary).every((s) => s.consistent)) process.exitCode = 1;
