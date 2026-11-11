import { randomUUID } from "node:crypto";
import {
  actionIdentitySchema,
  actionVersionSchema,
  feedbackSchema,
  requestObjectSchema,
} from "../../contracts/requests.mjs";
import { flowIssue } from "../domain/index.mjs";
import { currentArtifact, pendingState as pending, recordEvent } from "../monitor.mjs";
import {
  COMPLETION_REASON,
  confirmPendingStop,
  EDITORIAL_LIMITS,
  fail,
  resetBudget,
  userTransition,
} from "./lifecycle.mjs";

export async function runAction(service, id, input) {
  if (!requestObjectSchema.safeParse(input).success) fail("요청 내용을 확인해 주세요.");
  const { operationId, expectedVersion, type, feedback } = input;
  if (!actionIdentitySchema.safeParse(input).success) fail("지원하지 않는 요청입니다.");
  const changed = await service.locked(id, async () => {
    const run = service.store.get(id);
    const beforeStatus = run.state.status;
    const signature = JSON.stringify({ expectedVersion, type, feedback });
    if (Object.hasOwn(run.operations ?? {}, operationId)) {
      if (run.operations[operationId] !== signature)
        fail("같은 요청 번호의 내용이 달라졌습니다.", 409);
      return false;
    }
    if (!actionVersionSchema.safeParse(input).success || expectedVersion !== run.state.version)
      fail("다른 화면에서 작업이 변경됐습니다. 최신 내용을 확인해 주세요.", 409);
    if (type === "feedback" && !feedbackSchema.safeParse(feedback).success)
      fail("수정할 내용을 입력해 주세요.");
    const completionReason = flowIssue(run.state);
    if (completionReason && !["complete_requirements", "pause"].includes(type))
      fail(COMPLETION_REASON, 409);
    const event = { id: operationId, actor: "user", type, expectedVersion };
    if (type === "complete_requirements") {
      if (!completionReason) fail("보완할 요구사항이 없습니다.", 409);
      const stopped = await confirmPendingStop(service, run);
      const previous = run.state;
      const next = userTransition(previous, event);
      const snapshot = next.history.at(-1);
      Object.assign(snapshot, {
        status: previous.status,
        stage: previous.stage,
        completionReason: COMPLETION_REASON,
        reviewed: Boolean(
          currentArtifact(previous, "draft") && currentArtifact(previous, "review"),
        ),
        ...(stopped?.status === "completed"
          ? { pendingResult: { jobId: stopped.id, event: structuredClone(stopped.event) } }
          : run.legacyPendingResult
            ? { pendingResult: run.legacyPendingResult }
            : {}),
      });
      run.state = next;
      delete run.legacyPendingResult;
      run.pending = null;
      resetBudget(service, run, EDITORIAL_LIMITS.initialCalls);
    } else if (type === "pause") {
      if (!pending(run.state)) fail("진행 중인 작업만 중단할 수 있습니다.", 409);
      const stopped = await confirmPendingStop(service, run);
      let state = run.state;
      if (stopped?.status === "completed" && !completionReason)
        state = userTransition(state, stopped.event);
      run.state = userTransition(state, { ...event, expectedVersion: state.version });
      if (stopped?.status === "completed" && completionReason)
        run.legacyPendingResult = { jobId: stopped.id, event: structuredClone(stopped.event) };
      run.pending = null;
    } else if (type === "feedback") {
      run.state = userTransition(run.state, {
        ...event,
        reviewedRevision: run.state.revision,
        feedback: feedback.trim(),
      });
      run.pending = null;
      resetBudget(service, run);
    } else if (["satisfy", "authorize_publication"].includes(type)) {
      run.state = userTransition(run.state, { ...event, reviewedRevision: run.state.revision });
    } else {
      const state = run.state;
      if (["paused", "failed"].includes(state.status)) {
        run.state = userTransition(state, {
          ...event,
          type: state.status === "paused" ? "resume" : "retry",
        });
        run.pending = null;
        resetBudget(service, run);
      } else if (!pending(state)) fail("이어갈 작업이 없습니다.", 409);
    }
    run.issue = null;
    run.issueKind = null;
    if (pending(run.state)) {
      run.queuedAt = service.now();
      run.worker = null;
    }
    const labels = {
      pause: "중단 확인",
      feedback: "수정 요청",
      complete_requirements: "전체 요구사항 보완 요청",
      satisfy: "초안 확정",
      authorize_publication: "발행 준비 승인",
      resume:
        beforeStatus === "failed"
          ? "실패 단계 재시도"
          : beforeStatus === "paused"
            ? "중단 작업 재개"
            : "진행 다시 연결",
    };
    recordEvent(
      run,
      service.now(),
      type,
      labels[type],
      type === "feedback" ? { reason: feedback.trim() } : {},
    );
    run.operations = { ...run.operations, [operationId]: signature };
    service.save(run);
    return true;
  });
  return changed && !["pause", "satisfy", "authorize_publication"].includes(type)
    ? service.connect(id)
    : service.get(id);
}

export function failRun(service, run, message) {
  run.state = userTransition(run.state, {
    id: randomUUID(),
    actor: "adapter",
    type: "fail",
    expectedVersion: run.state.version,
    stage: run.state.stage,
    revision: run.state.revision,
    error: message,
  });
  run.issue = message;
  run.issueKind = "failed";
  recordEvent(run, service.now(), "failed", "실패", { reason: message });
  return service.save(run);
}
