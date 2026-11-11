// 작업 기록의 제공자 보고 사용량을 단계별로 합산한다. 추정치 없이 보고된 값만 사용.
const fields = ["inputTokens", "cachedInputTokens", "outputTokens"];

export function usageSummary(jobs) {
  const empty = () => Object.fromEntries([...fields.map((field) => [field, 0]), ["calls", 0]]);
  const total = { ...empty(), unreported: 0 };
  const stages = {};
  for (const job of jobs) {
    const key = job.action?.type === "request_route" ? "route" : (job.action?.stage ?? "unknown");
    const usage = job.usage;
    if (!usage || fields.every((field) => typeof usage[field] !== "number")) {
      total.unreported += 1;
      continue;
    }
    stages[key] ??= empty();
    for (const target of [stages[key], total]) {
      target.calls += 1;
      for (const field of fields) target[field] += Number(usage[field]) || 0;
    }
  }
  return { total, stages };
}
