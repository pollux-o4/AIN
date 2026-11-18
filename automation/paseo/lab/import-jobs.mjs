// 앱 실행 기록(.local/ai-runtime/jobs)을 연구소 기록으로 옮긴다 · 글 하나의 위치 제안과 그림마다 한 건씩
// 사용: node import-jobs.mjs <글 id 앞부분> <사례 앞이름> <변형> [회차]
// 시간은 작업마다 (마지막 단계 시각 - 생성 시각)의 합, 토큰은 usage 합 · 시각 확인은 작업 기록에 도구 이름이 없어 null
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAB_ROOT, writeLabIndex, writeLabRecord } from "./store.mjs";
import { LAB_VARIANTS } from "./variants.mjs";

const JOBS = ".local/ai-runtime/jobs";
const [prefix, casePrefix, variant, trialArg = "1"] = process.argv.slice(2);
if (!prefix || !casePrefix || !variant) {
  console.error("사용법: node import-jobs.mjs <글 id 앞부분> <사례 앞이름> <변형> [회차]");
  process.exit(2);
}
const trial = Number(trialArg);

const jobs = [];
for (const name of (await readdir(JOBS)).filter((n) => n.endsWith(".json"))) {
  const job = JSON.parse(await readFile(join(JOBS, name), "utf8"));
  if (job.state?.articleId?.startsWith(prefix)) jobs.push(job);
}
jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
// 결과 상태(그림 본문)는 뒤 작업의 입력 상태에도 남으므로 모든 작업에서 읽고, 시간·토큰은 끝난 작업만 센다
const done = jobs.filter((j) => j.status === "completed");

const nullIfZero = (n) => (n === 0 ? null : n); // 단계 시각이 없는 작업은 시간을 모른다
const measure = (list) => ({
  ms: nullIfZero(
    list.reduce(
      (sum, j) =>
        sum +
        Math.max(0, (j.steps?.at(-1)?.at ?? Date.parse(j.createdAt)) - Date.parse(j.createdAt)),
      0,
    ),
  ),
  tokens: {
    input: list.reduce(
      (s, j) => s + (j.usage?.inputTokens ?? 0) + (j.usage?.cachedInputTokens ?? 0),
      0,
    ),
    output: list.reduce((s, j) => s + (j.usage?.outputTokens ?? 0), 0),
  },
});
const base = (list) => ({
  variant,
  trial,
  at: list[0].createdAt,
  ref: null,
  model: list[0].providerModel ?? null,
  ...measure(list),
  visual: null,
  verdict: null,
});

const latest = jobs.findLast((j) => j.state.figure?.candidates?.length);
// 위치 제안은 그림 id 없는 그림 작업 · 그림마다 층(draft·content·visual)은 역할 끝의 :<그림 id>로 묶는다
const planners = done.filter((j) => j.action?.type === "request_figure" && !j.action.figureId);
if (planners.length && latest) {
  await writeLabRecord(LAB_ROOT, {
    ...base(planners),
    case: casePrefix,
    stage: "plan",
    candidates: latest.state.figure.candidates.map((c) => ({
      anchor: c.anchor.replace(/\*/g, "").slice(0, 30),
      ...(c.relation && { relation: c.relation }),
      ...(c.without && { without: c.without }),
      ...(c.mapping && { mapping: c.mapping }),
    })),
  });
}

const tmp = await mkdtemp(join(tmpdir(), "lab-"));
const items = [
  ...new Map(jobs.flatMap((j) => j.state.figure?.items ?? []).map((i) => [i.id, i])).values(),
];
for (const item of items) {
  const drawers = done.filter((j) => j.role?.endsWith(`:${item.id}`));
  if (!drawers.length || !item.svg) continue;
  const from = join(tmp, `${item.id}.svg`);
  await writeFile(from, item.svg);
  await writeLabRecord(
    LAB_ROOT,
    {
      ...base(drawers),
      case: `${casePrefix}-${item.id}`,
      stage: "figure",
      note: `층 ${drawers.length}회`,
    },
    [{ from, path: "figure.svg", mime: "image/svg+xml" }],
  );
}
const lab = await writeLabIndex(LAB_ROOT, LAB_VARIANTS);
console.log(`가져옴: 그림 ${items.length}개 · 전체 기록 ${lab.records.length}건`);
