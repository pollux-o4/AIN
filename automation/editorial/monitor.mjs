import { currentArtifact, flowIssue, STAGES } from "./domain/index.mjs";

export { currentArtifact };

// 작업 상태와 실행 관측을 분리; heartbeat는 AI 완료나 진척률의 증명이 아님.
const STALE_AFTER_MS = 15000;
const stages = {
  diagnose: "진단",
  topic: "주제 정리",
  audience: "독자 정리",
  value: "핵심 정리",
  research: "근거 정리",
  outline: "구성",
  draft: "초고 작성",
  review: "검토",
  route: "수정 위치 확인",
};
export const stageName = (stage) => stages[stage] ?? stage;
export const pendingState = (state) => ["waiting_ai", "waiting_route"].includes(state.status);

export function recordEvent(run, now, kind, label, details = {}) {
  run.events ??= [];
  run.events.push({
    at: now,
    kind,
    label,
    revision: run.state.revision,
    stage: run.state.status === "waiting_route" ? "route" : run.state.stage,
    executionId: run.worker?.executionId ?? null,
    ...details,
  });
}
// 현재 초안 회차의 단계 진행: 완료=산출물 존재, 진행=대기 중인 현재 단계. 시각은 기록된 이벤트만 사용.
export function runPipeline(run) {
  const state = run.state,
    events = (run.events ?? []).filter((e) => e.revision === state.revision);
  const current = flowIssue(state)
    ? null
    : { waiting_ai: "active", paused: "paused", failed: "failed" }[state.status];
  const at = (stage, kind) =>
    events.findLast((e) => e.stage === stage && e.kind === kind)?.at ?? null;
  const steps = STAGES.map((stage) => ({
    stage,
    name: stageName(stage),
    status: currentArtifact(state, stage)
      ? "done"
      : current && stage === state.stage
        ? current
        : "pending",
    startedAt: at(stage, "ai_requested"),
    completedAt: currentArtifact(state, stage) ? at(stage, "ai_completed") : null,
  }));
  if (state.status === "waiting_route")
    steps.unshift({
      stage: "route",
      name: stageName("route"),
      status: flowIssue(state) ? "pending" : "active",
      startedAt: at("route", "ai_requested"),
      completedAt: null,
    });
  return steps;
}
export function runMonitor(run, now) {
  const state = run.state,
    stage = state.status === "waiting_route" ? "route" : state.stage;
  const lastConfirmedAt = run.worker?.confirmedAt ?? null;
  const lastActivity = lastConfirmedAt ?? run.queuedAt ?? run.startedAt;
  const completionReason = flowIssue(state);
  let kind, label;
  if (completionReason) {
    kind = "blocked";
    label = "요구사항 보완 필요";
  } else if (state.status === "satisfied") {
    kind = "ready";
    label = "초안 확정";
  } else if (state.status === "publication_ready") {
    kind = "ready";
    label = "발행 준비 승인";
  } else if (state.status === "awaiting_user") {
    kind = "ready";
    label = "초안 준비됨";
  } else if (state.status === "paused") {
    kind = "paused";
    label = "중단됨";
  } else if (state.status === "failed") {
    kind = "failed";
    label = "실패";
  } else if (run.issue) {
    kind = "blocked";
    label = "확인 필요";
  } else if (now - lastActivity > STALE_AFTER_MS) {
    kind = "stale";
    label = "진행 확인 지연";
  } else if (run.pending?.jobId) {
    kind = "working";
    label = `${stageName(stage)} 중`;
  } else {
    kind = "queued";
    label = `${stageName(stage)} 대기`;
  }
  return {
    kind,
    label,
    lastConfirmedAt,
    needsAiAttention:
      kind === "blocked" &&
      ["ai_attention", "ai_connection", "stop_unconfirmed"].includes(run.issueKind),
    canPause: pendingState(state),
    canResume: !completionReason && ["paused", "failed", "stale", "blocked"].includes(kind),
    resumeLabel:
      kind === "stale" ? "진행 다시 연결" : kind === "blocked" ? "상태 다시 확인" : "이어가기",
    events: run.events ?? [],
    pipeline: runPipeline(run),
    now,
    executionId: run.worker?.executionId ?? null,
  };
}
