import type { HistoryRecord, WritingJourneyEntry } from "../shared/api";

// 한 단계의 회차별 실행 · 회차 = 초안 번호, 시도 = 같은 회차 안의 재실행(구간·예산 초과 등)
export type StageTurn = {
  revision: number;
  request: string | null;
  attempts: HistoryRecord[];
  result: HistoryRecord;
};
export type RevisionSlot = { revision: number; turn: StageTurn | null };
export type StageTurns = {
  turns: StageTurn[];
  // 현재 산출물을 만든 회차 · 기본 선택
  source: StageTurn | null;
  // 1..현재 회차 · 실행이 없던 회차는 앞 결과 유지
  slots: RevisionSlot[];
};

const executed = (record: HistoryRecord) =>
  record.kind === "ai_completed" || record.steps.length > 0;

export function stageTurns(
  records: HistoryRecord[],
  journey: WritingJourneyEntry[],
  stage: string,
  currentRevision: number,
): StageTurns {
  const byRevision = new Map<number, HistoryRecord[]>();
  for (const record of records) {
    if (record.stage !== stage || !executed(record)) continue;
    byRevision.set(record.revision, [...(byRevision.get(record.revision) ?? []), record]);
  }
  const turns = [...byRevision.entries()]
    .sort(([a], [b]) => a - b)
    .map(([revision, attempts]) => ({
      revision,
      request: journey.find((entry) => entry.revision === revision)?.request ?? null,
      attempts,
      result:
        attempts.findLast((record) => record.kind === "ai_completed") ??
        (attempts.at(-1) as HistoryRecord),
    }));
  const source = turns.findLast((turn) => turn.result.kind === "ai_completed") ?? null;
  const first = turns[0]?.revision ?? currentRevision + 1;
  const slots = Array.from({ length: Math.max(0, currentRevision - first + 1) }, (_, i) => {
    const revision = first + i;
    return { revision, turn: turns.find((turn) => turn.revision === revision) ?? null };
  });
  return { turns, source, slots };
}
