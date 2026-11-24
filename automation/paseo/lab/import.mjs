import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAB_ROOT, writeLabIndex, writeLabRecord } from "./store.mjs";
import { LAB_VARIANTS } from "./variants.mjs";

const nullIfZero = (n) => (n === 0 ? null : n);
const measure = (list) => ({
  ms: nullIfZero(
    list.reduce(
      (sum, job) =>
        sum +
        Math.max(
          0,
          (job.steps?.at(-1)?.at ?? Date.parse(job.createdAt)) - Date.parse(job.createdAt),
        ),
      0,
    ),
  ),
  tokens: {
    input: list.reduce(
      (sum, job) => sum + (job.usage?.inputTokens ?? 0) + (job.usage?.cachedInputTokens ?? 0),
      0,
    ),
    output: list.reduce((sum, job) => sum + (job.usage?.outputTokens ?? 0), 0),
  },
});

/** @param {{ jobsDir: string, articleId: string, caseId: string, variant: string, trial: number, ref: string, state?: any }} options state: 편집 저장소의 최종 상태 · 위치 제안만 돌리면 후보는 여기에만 있다 */
export async function importArticle({ jobsDir, articleId, caseId, variant, trial, ref, state }) {
  const jobs = [];
  for (const name of (await readdir(jobsDir)).filter((entry) => entry.endsWith(".json"))) {
    const job = JSON.parse(await readFile(join(jobsDir, name), "utf8"));
    // 그림 묶음 기록은 결과를 모으기만 한다 · 실제 작업(모델·사용량·변형)은 장마다의 기록에 있다 · ADR-0026
    if (job.state?.articleId === articleId && job.kind !== "batch") jobs.push(job);
  }
  jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const done = jobs.filter((job) => job.status === "completed");
  const ran = new Set(done.map((job) => job.labVariant ?? "baseline"));
  if (ran.size !== 1 || !ran.has(variant))
    throw new Error(
      `작업 기록의 변형(${[...ran].join(",")})과 지정한 변형(${variant})이 다릅니다.`,
    );

  const base = (list) => ({
    variant,
    trial,
    at: list[0].createdAt,
    ref,
    model: list[0].providerModel ?? null,
    ...measure(list),
    visual: null,
    verdict: null,
  });
  const records = [];
  const figure =
    state?.figure ?? jobs.findLast((job) => job.state.figure?.candidates?.length)?.state.figure;
  const jobsOf = (stage) =>
    done.filter((job) => job.action?.type === "request_figure" && job.action.stage === stage);
  const brief = (candidate) => ({
    id: candidate.id,
    anchor: candidate.anchor.replace(/\*/g, "").slice(0, 30),
    ...(candidate.without && { without: candidate.without }),
  });
  // 위치 선정 기록: 자리와 관계만
  if (jobsOf("figure_plan").length && figure?.candidates?.length)
    records.push(
      await writeLabRecord(LAB_ROOT, {
        ...base(jobsOf("figure_plan")),
        case: caseId,
        stage: "plan",
        candidates: figure.candidates.map(brief),
      }),
    );
  // 구성 기록: 고른 자리의 장면·비유·대응표와 장면 세계 · 대상 정책 실험의 판정 근거 · ADR-0026
  if (jobsOf("figure_compose").length && figure?.selected?.length)
    records.push(
      await writeLabRecord(LAB_ROOT, {
        ...base(jobsOf("figure_compose")),
        case: caseId,
        stage: "compose",
        ...(figure.world && { world: figure.world }),
        candidates: figure.candidates
          .filter((candidate) => figure.selected.includes(candidate.id))
          .map((candidate) => ({
            ...brief(candidate),
            ...(candidate.analogy && { analogy: candidate.analogy }),
            ...(candidate.scene && { scene: candidate.scene }),
            ...(candidate.mapping && { mapping: candidate.mapping }),
          })),
      }),
    );

  const tempDir = await mkdtemp(join(tmpdir(), "lab-"));
  try {
    const items = [
      ...new Map(
        [...jobs.flatMap((job) => job.state.figure?.items ?? []), ...(figure?.items ?? [])].map(
          (item) => [item.id, item],
        ),
      ).values(),
    ];
    for (const item of items) {
      const drawers = done.filter((job) => job.role?.endsWith(`:${item.id}`));
      if (!drawers.length || !item.svg) continue;
      const from = join(tempDir, `${item.id}.svg`);
      await writeFile(from, item.svg);
      records.push(
        await writeLabRecord(
          LAB_ROOT,
          {
            ...base(drawers),
            case: `${caseId}-${item.id}`,
            stage: "figure",
            note: `층 ${drawers.length}회`,
          },
          [{ from, path: "figure.svg", mime: "image/svg+xml" }],
        ),
      );
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
  await writeLabIndex(LAB_ROOT, LAB_VARIANTS);
  return records;
}
