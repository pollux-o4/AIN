import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAB_ROOT, writeLabIndex, writeLabRecord } from "./store.mjs";
import { LAB_VARIANTS } from "./variants.mjs";

const byStage = (events, stage) => {
  const starts = new Map(
    events.filter((event) => event.kind === "ai_requested").map((event) => [event.jobId, event]),
  );
  return events
    .filter(
      (event) => event.kind === "ai_completed" && event.stage === stage && starts.has(event.jobId),
    )
    .map((event) => ({ start: starts.get(event.jobId), end: event }));
};

const countTokens = (usage) =>
  usage.length &&
  usage.every(
    (pair) =>
      Number.isSafeInteger(pair?.inputTokens) &&
      pair.inputTokens >= 0 &&
      Number.isSafeInteger(pair?.outputTokens) &&
      pair.outputTokens >= 0,
  )
    ? {
        input: usage.reduce((total, pair) => total + pair.inputTokens, 0),
        output: usage.reduce((total, pair) => total + pair.outputTokens, 0),
      }
    : null;

export async function importGoReport({
  report,
  caseId,
  variant,
  trial,
  ref = null,
  root = LAB_ROOT,
}) {
  const { events, layers, figure, lab } = report;
  if ((lab?.variant ?? "baseline") !== variant)
    throw new Error("실행 기록과 지정한 연구소 변형이 다릅니다.");
  const model = lab?.model ?? null;
  const base = (pairs, usage, ms) => ({
    variant,
    trial,
    model,
    ref,
    ms,
    at: new Date(pairs[0].start.at).toISOString(),
    tokens: countTokens(usage),
    visual: null,
    verdict: null,
  });
  const records = [];
  const brief = ({ id, anchor, without }) => ({
    id,
    anchor: anchor.replace(/\*/g, "").slice(0, 30),
    ...(without && { without }),
  });
  for (const stage of ["plan", "compose"]) {
    const pairs = byStage(events, `figure_${stage}`);
    if (!pairs.length || !figure?.candidates?.length) continue;
    const candidate = (c) => ({
      ...brief(c),
      ...(c.analogy && { analogy: c.analogy }),
      ...(c.scene && { scene: c.scene }),
      ...(c.mapping && { mapping: c.mapping }),
    });
    const candidates =
      stage === "plan"
        ? figure.candidates.map(brief)
        : figure.candidates.filter((c) => figure.selected?.includes(c.id)).map(candidate);
    if (!candidates.length) continue;
    const ms = pairs.reduce((total, { start, end }) => total + Math.max(0, end.at - start.at), 0);
    records.push(
      await writeLabRecord(root, {
        ...base(
          pairs,
          pairs.map(({ end }) => end.usage),
          ms,
        ),
        case: caseId,
        stage,
        candidates,
        ...(stage === "compose" && figure.world && { world: figure.world }),
      }),
    );
  }
  const figurePairs = byStage(events, "figure");
  const scratch = await mkdtemp(join(tmpdir(), "ain-lab-svg-"));
  try {
    for (const { id, svg } of figure?.items ?? []) {
      if (!svg || !/^f[0-9]{1,3}$/.test(id)) continue;
      const drawn = layers.filter(
        (layer) => layer.figure === id && figurePairs.some(({ end }) => end.jobId === layer.parent),
      );
      if (!drawn.length) continue;
      const pairs = figurePairs.filter(({ end }) =>
        drawn.some((layer) => layer.parent === end.jobId),
      );
      const path = join(scratch, "figure.svg");
      await writeFile(path, svg, { mode: 0o600 });
      // shortcut: 그림별 실행 시각은 저장하지 않아 시간 집계 생략, 층별 시각 영속화 시 재검토.
      records.push(
        await writeLabRecord(
          root,
          {
            ...base(
              pairs,
              drawn.map((layer) => layer.usage),
              null,
            ),
            case: `${caseId}-${id}`,
            stage: "figure",
            note: `층 ${drawn.length}회`,
          },
          [{ from: path, path: "figure.svg", mime: "image/svg+xml" }],
        ),
      );
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  await writeLabIndex(root, LAB_VARIANTS);
  return records;
}
