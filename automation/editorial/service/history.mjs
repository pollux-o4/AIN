import { failureReason, stageName } from "../monitor.mjs";
import { writingJourney } from "./journey.mjs";
import { usageReport } from "./usage.mjs";

const goals = {
  diagnose: "글의 목적·독자·문체와 작성 방향을 정합니다.",
  topic: "다룰 문제와 주제의 범위를 정합니다.",
  audience: "대상 독자와 독자가 얻고 싶은 것을 정합니다.",
  value: "글이 전달할 가치와 유지할 내용을 정합니다.",
  research: "근거·출처와 추가 확인이 필요한 내용을 정리합니다.",
  outline: "글의 구성과 전개 순서를 정합니다.",
  draft: "앞 단계의 결과와 사용자 요구를 반영해 본문을 작성합니다.",
  review: "본문의 오류·근거·원문 보존 여부를 검토합니다.",
  route: "수정 의견을 반영할 시작 단계를 선택합니다.",
  figure_plan: "확정된 초안에서 시각자료가 도울 위치와 보여줄 주장을 제안합니다.",
  figure: "선택한 위치에 놓을 시각자료를 만듭니다. 본문은 바꾸지 않습니다.",
};
// shortcut: 과거 실행 파일이 없으면 보존 산출물만 표시, 작업 파일 보존 정책 변경 시 전용 이력 저장소 검토
function retainedOutput(state, revision, stage) {
  const snapshot =
    state.revision === revision ? state : state.history?.find((h) => h.revision === revision);
  return snapshot?.artifacts?.[stage]?.output ?? null;
}

// Reconstruct from persisted execution evidence; a history read never resumes work.
export async function executionHistory(service, id) {
  const run = service.store.get(id);
  const events = run.events ?? [];
  const ids = [...new Set(events.map((event) => event.jobId).filter(Boolean))];
  const jobs = new Map();
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, ids.length) }, async () => {
      while (cursor < ids.length) {
        const jobId = ids[cursor++];
        try {
          jobs.set(jobId, await service.jobs.describe(jobId));
        } catch {
          jobs.set(jobId, null);
        }
      }
    }),
  );
  const records = events.map((event, index) => {
    const job = jobs.get(event.jobId);
    const completed = event.kind === "ai_completed";
    const feedback =
      event.kind === "feedback"
        ? events
            .slice(index + 1)
            .filter((next) => next.revision === event.revision && next.jobId)
            .map((next) => jobs.get(next.jobId)?.feedback)
            .find(Boolean)
        : null;
    const executionIssue = job?.status === "failed" ? failureReason(job.failureKind) : null;
    const fallback =
      completed && !job ? retainedOutput(run.state, event.revision, event.stage) : null;
    const inputs = job
      ? [
          "글감",
          ...(job.inputs.source ? ["참고 자료"] : []),
          ...(job.inputs.feedback ? ["수정 의견"] : []),
          ...job.inputs.stages.map((stage) => `${stageName(stage)} 결과`),
          ...(job.inputs.baseline ? ["이전 회차의 해당 단계 결과"] : []),
        ]
      : [];
    return {
      key: String(index),
      at: event.at,
      kind: event.kind,
      label: event.label,
      revision: event.revision,
      stage: event.stage ?? "",
      name: stageName(event.stage ?? ""),
      goal: ["ai_requested", "ai_completed"].includes(event.kind) ? (goals[event.stage] ?? "") : "",
      inputs,
      inputsSource: job ? (job.inputsRecorded ? "recorded" : "reconstructed") : "unavailable",
      model: job?.model ?? null,
      executionId: event.executionId ?? null,
      output: completed ? (job?.output ?? fallback) : null,
      resultSource: completed && job?.output ? "job" : fallback ? "artifact" : "none",
      target: completed ? (job?.target ? stageName(job.target) : null) : null,
      reason:
        event.reason ?? (completed ? (job?.reason ?? null) : null) ?? feedback ?? executionIssue,
      unavailable: Boolean(event.jobId && !job),
      // 실행마다 한 번만: 완료면 완료 기록, 실패면 요청 기록에 붙인다
      steps:
        completed || (event.kind === "ai_requested" && job?.status === "failed")
          ? (job?.steps ?? [])
          : [],
    };
  });
  return {
    records,
    journey: writingJourney(run.state, records),
    usage: usageReport(events, jobs, (service.now ?? Date.now)()),
  };
}
