import { STAGES, transition } from "../domain/index.mjs";
import { recordEvent } from "../monitor.mjs";

export const COMPLETION_REASON =
  "전체 글쓰기 단계와 결과를 보완해야 합니다. 요구사항 보완을 눌러 주세요.";
export const DEFAULT_AI = {
  provider: "antigravity",
  model: "gemini-3.8-flash-medium",
  enabled: true,
  maxDurationMs: 120000,
};
export const EDITORIAL_LIMITS = {
  initialCalls: STAGES.length,
  followupCalls: STAGES.length + 1,
  maxRunMs: 600000,
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
