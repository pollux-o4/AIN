import { FIGURE_LIMITS, FIGURE_PASSES } from "../../contracts/figure.mjs";
import { currentOf, figureStage } from "../domain/figures.mjs";
import { STAGES, transition } from "../domain/index.mjs";
import { recordEvent } from "../monitor.mjs";

export const COMPLETION_REASON =
  "전체 글쓰기 단계와 결과를 보완해야 합니다. 요구사항 보완을 눌러 주세요.";
// 사람 요청 1회의 AI 호출 수: 위치 제안 1회 · 생성은 남은 (그림 × 층) 수 · FIGURE-001 · ADR-0017
export function figureCalls(state) {
  if (figureStage(state) !== "figure") return 1;
  const { selected } = state.figure;
  const { id, pass } = currentOf(state.figure);
  const left = selected.length - selected.indexOf(id);
  return left * FIGURE_PASSES.length - FIGURE_PASSES.indexOf(pass);
}
// 실행 시간 한도: 생성은 한 층이 긴 도구 작업이라 남은 호출 수 × 생성 한도
export const runLimitMs = (state) =>
  figureStage(state) === "figure"
    ? FIGURE_LIMITS.generateMs * figureCalls(state)
    : EDITORIAL_LIMITS.maxRunMs;
export const EDITORIAL_LIMITS = {
  initialCalls: STAGES.length,
  followupCalls: STAGES.length + 1,
  // 구간별 초고(최대 8구간)·자동 보정 포함 · 느린 고품질 호출을 수용
  maxRunMs: 1800000,
  // 사람 확인 없이 이어지는 에이전트(편집장) 수정 지시 상한 · ADR-0006
  agentFeedbackRounds: 2,
};
export function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
export function userTransition(state, event) {
  try {
    return transition(state, event).state;
  } catch (error) {
    fail(error.message, state === null ? 400 : 409);
  }
}
export function resetBudget(service, run, maxCalls = EDITORIAL_LIMITS.followupCalls) {
  run.callsUsed = 0;
  run.maxCalls = maxCalls;
  run.startedAt = service.now();
}

// stop() must return a confirmed terminal job; a successful transport response alone is insufficient.
export async function confirmPendingStop(service, run) {
  if (!run.pending) return null;
  try {
    const reserved = run.pending;
    const found = reserved.jobId ? { id: reserved.jobId } : await service.jobs.find(reserved.body);
    if (found === null) return null;
    if (!found?.id) throw new Error("Unknown reserved job");
    const stopped = await service.jobs.stop(found.id);
    if (!["completed", "failed"].includes(stopped?.status)) throw new Error("Stop not confirmed");
    return stopped;
  } catch {
    run.issue =
      "중단을 확인하지 못했습니다. 새 작업을 시작하지 않고 같은 작업을 보존했습니다. 다시 중단 또는 요구사항 보완을 눌러 주세요.";
    run.issueKind = "stop_unconfirmed";
    recordEvent(run, service.now(), "stop_unconfirmed", "중단 확인 실패");
    service.save(run);
    fail(run.issue, 503);
  }
}
