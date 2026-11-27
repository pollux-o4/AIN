import { deepStrictEqual } from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [baselinePath, candidatePath, ...rest] = process.argv.slice(2);
if (!baselinePath || !candidatePath || rest.length)
  throw new Error("Usage: node compare.mjs BASELINE.json CANDIDATE.json");
const [baseline, candidate] = await Promise.all(
  [baselinePath, candidatePath].map(async (path) => JSON.parse(await readFile(path, "utf8"))),
);
if (baseline.schema !== 1 || candidate.schema !== 1) throw new Error("Unsupported report schema");
deepStrictEqual(candidate.host, baseline.host, "Host differs");
deepStrictEqual(candidate.workload, baseline.workload, "Workload differs");
deepStrictEqual(candidate.diagnostics.logLevel, baseline.diagnostics.logLevel, "Log level differs");
if ((candidate.browserRenderMs === null) !== (baseline.browserRenderMs === null))
  throw new Error("Measure the browser in a separate, matching pair of reports");

function idleMedian(report, field) {
  const values = report.trials.map((trial) => trial.idle.memory.groups.ain[field]);
  if (values.some((value) => !Number.isFinite(value))) return null;
  return values.sort((a, b) => a - b)[Math.ceil(values.length / 2) - 1];
}
function compareIdle(field) {
  const before = idleMedian(baseline, field);
  const after = idleMedian(candidate, field);
  return {
    baseline: before,
    candidate: after,
    candidatePercent: before && after !== null ? Math.round((after / before) * 1000) / 10 : null,
  };
}
console.log(
  JSON.stringify(
    {
      baseline: baseline.runtime,
      candidate: candidate.runtime,
      ...(baseline.workload.browser
        ? {}
        : {
            idleAinRssKiB: compareIdle("rssKiB"),
            idleAinPssKiB: compareIdle("pssKiB"),
            concurrentSignalToSaveMs: {
              baseline: baseline.latencyMs.concurrent.signalToSave,
              candidate: candidate.latencyMs.concurrent.signalToSave,
            },
            historyMs: { baseline: baseline.historyMs, candidate: candidate.historyMs },
          }),
      browserRenderMs: { baseline: baseline.browserRenderMs, candidate: candidate.browserRenderMs },
    },
    null,
    2,
  ),
);
