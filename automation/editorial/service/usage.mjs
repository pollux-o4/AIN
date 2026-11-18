// 자원 사용량: 글 → 회차 → 단계 → 시도 · 큰 것부터 쳐내기 위한 집계 · 실행 기록과 같은 원천(이벤트 + AI 작업)
// 시도 시간 = 요청 → 결과 수거(또는 실패) · 수거가 늦으면 그만큼 길게 보임(끊김도 비용으로 드러냄)
import { stageName } from "../monitor.mjs";

const tokensOf = (usage) => (usage ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) : null);
const add = (a, b) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

function attemptsOf(events, jobs, now) {
  const attempts = [];
  events.forEach((event, i) => {
    if (event.kind !== "ai_requested") return;
    const later = events.slice(i + 1);
    const done = later.find((e) => e.kind === "ai_completed" && e.jobId === event.jobId);
    const stopped = done ? null : later.find((e) => e.kind === "failed");
    const end = done ?? stopped;
    // 결과를 받은 그 처리에서 실패로 멈췄으면 결과는 거부된 것(재시도 상한 소진)
    const refused = done && events[events.indexOf(done) + 1];
    const rejectedAtEnd = refused?.kind === "failed" && refused.at === done.at;
    const job = jobs.get(event.jobId);
    attempts.push({
      jobId: event.jobId,
      revision: event.revision,
      stage: event.stage,
      section: job?.section ?? null,
      ms: (end?.at ?? now) - event.at,
      tokens: tokensOf(job?.usage),
      chars: job?.chars ?? null,
      outcome: rejectedAtEnd ? "rejected" : done ? "accepted" : stopped ? "failed" : "running",
    });
  });
  // 같은 회차·단계·구간을 다시 요청했으면 앞 시도는 거부된 것
  attempts.forEach((a, i) => {
    const again = attempts
      .slice(i + 1)
      .some(
        (b) =>
          b.revision === a.revision &&
          b.stage === a.stage &&
          (b.section?.index ?? null) === (a.section?.index ?? null),
      );
    if (again && a.outcome === "accepted") a.outcome = "rejected";
  });
  return attempts;
}

function total(items) {
  return items.reduce(
    (sum, a) => ({
      ms: sum.ms + a.ms,
      tokens: add(sum.tokens, a.tokens),
      calls: sum.calls + (a.calls ?? 1),
      wasted: sum.wasted + (a.wasted ?? (["rejected", "failed"].includes(a.outcome) ? 1 : 0)),
    }),
    { ms: 0, tokens: null, calls: 0, wasted: 0 },
  );
}

function groupBy(items, key) {
  const groups = new Map();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return [...groups.entries()];
}

const label = (a) =>
  `회차 ${a.revision} · ${stageName(a.stage)}${a.section ? ` ${a.section.index + 1}/${a.section.total}` : ""}`;

export function usageReport(events, jobs, now) {
  const attempts = attemptsOf(events, jobs, now);
  const revisions = groupBy(attempts, (a) => a.revision).map(([revision, items]) => {
    const stages = groupBy(items, (a) => a.stage).map(([stage, list]) => ({
      stage,
      name: stageName(stage),
      ...total(list),
      attempts: list.map((a) => ({ ...a, label: label(a) })),
    }));
    return { revision, ...total(stages), stages };
  });
  // 먼저 볼 곳: 시간이 큰 시도 순 · 거부·실패는 그대로 낭비
  const hotspots = attempts
    .map((a) => ({ label: label(a), ms: a.ms, tokens: a.tokens, outcome: a.outcome }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 3);
  return { ...total(revisions), revisions, hotspots };
}
