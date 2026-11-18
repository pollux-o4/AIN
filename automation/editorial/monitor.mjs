import { FIGURE_PASSES } from "../contracts/figure.mjs";
import { isPendingStatus } from "../contracts/status.mjs";
import { passOf } from "./domain/figures.mjs";
import { currentArtifact, flowIssue, STAGES, workStage } from "./domain/index.mjs";

export { currentArtifact, workStage };

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
  figure_plan: "시각자료 제안",
  figure: "시각자료 생성",
};
export const stageName = (stage) => stages[stage] ?? stage;
// 생성 층 표시: 사람이 지금 어느 층(초안·내용·시각)을 기다리는지 · ADR-0011
const PASS_NAMES = { draft: "초안", content: "내용 다듬기", visual: "시각 마감" };
function workName(state, stage) {
  const pass =
    stage === "figure" && state.figure?.phase === "generate" ? passOf(state.figure) : null;
  if (!pass) return stageName(stage);
  return `${stageName(stage)} · ${PASS_NAMES[pass]} ${FIGURE_PASSES.indexOf(pass) + 1}/${FIGURE_PASSES.length}`;
}
const failureReasons = {
  timeout: "AI 실행 제한 시간을 넘겼습니다.",
  cancelled: "AI 실행이 중단됐습니다.",
  usage_limit: "AI 사용 한도에 도달했습니다. 한도가 회복된 뒤 다시 시도해 주세요.",
  authentication: "AI 제공자 로그인이 필요합니다.",
  provider_error: "AI 제공자가 오류를 반환했습니다.",
  invalid_output: "AI 응답이 약속한 결과 형식과 달라 쓰지 못했습니다.",
};
export const failureReason = (kind) =>
  failureReasons[kind] ?? "AI 응답을 편집 결과로 확정하지 못했습니다.";
export const pendingState = (state) => isPendingStatus(state.status);

export function recordEvent(run, now, kind, label, details = {}) {
  run.events ??= [];
  run.events.push({
    at: now,
    kind,
    label,
    revision: run.state.revision,
    stage: workStage(run.state),
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
    : { waiting_ai: "active", waiting_figure: "active", paused: "paused", failed: "failed" }[
        state.status
      ];
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
  // 시각자료는 선택 단계: 시작한 글에만 덧붙임 · 완료=다음 단계로 넘어간 사실 · FIGURE-001
  const phase = state.figure?.phase;
  if (phase) {
    const working = workStage(state);
    const figureStep = (stage, done) => ({
      stage,
      name: stageName(stage),
      status: done ? "done" : working === stage ? (current ?? "pending") : "pending",
      startedAt: at(stage, "ai_requested"),
      completedAt: done ? at(stage, "ai_completed") : null,
    });
    steps.push(
      figureStep("figure_plan", phase !== "propose"),
      figureStep("figure", ["review", "confirmed"].includes(phase)),
    );
  }
  return steps;
}
export function runMonitor(run, now) {
  const state = run.state,
    stage = workStage(state);
  const lastConfirmedAt = run.worker?.confirmedAt ?? null;
  const lastActivity = lastConfirmedAt ?? run.queuedAt ?? run.startedAt;
  const completionReason = flowIssue(state);
  let kind, label;
  if (completionReason) {
    kind = "blocked";
    label = "요구사항 보완 필요";
  } else if (state.status === "satisfied") {
    kind = "ready";
    // 확인된 시각자료가 있으면 그 사실을 표시 · 발행 준비 승인과는 별개
    label = state.figure ? "시각자료 확인됨" : "초안 확정";
  } else if (state.status === "publication_ready") {
    kind = "ready";
    label = "발행 준비 승인";
  } else if (state.status === "awaiting_figure_choice") {
    kind = "ready";
    label = "시각자료 위치 선택 대기";
  } else if (state.status === "awaiting_figure_review") {
    kind = "ready";
    label = "시각자료 확인 대기";
  } else if (state.status === "awaiting_brief") {
    kind = "ready";
    label = "수정 해석 확인 대기";
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
    label = `${workName(state, stage)} 중`;
  } else {
    kind = "queued";
    label = `${workName(state, stage)} 대기`;
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
