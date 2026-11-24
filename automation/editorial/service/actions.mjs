import { randomUUID } from "node:crypto";
import { actionAllowed, actionSpec, countsAsRound } from "../../contracts/actions.mjs";
import {
  FIGURE_LIMITS,
  figureDirectionsSchema,
  figureIdsSchema,
  figureLookSchema,
  figureRoutesSchema,
} from "../../contracts/figure.mjs";
import { effectiveRoute } from "../../contracts/figure-result.mjs";

const ROUTE_NAMES = { image: "이미지", svg: "SVG" };

import {
  actionIdentitySchema,
  actionRequestSchema,
  actionVersionSchema,
  briefEditSchema,
  feedbackSchema,
  requestObjectSchema,
} from "../../contracts/requests.mjs";
import { figureStage } from "../domain/figures.mjs";
import { flowIssue } from "../domain/index.mjs";
import { currentArtifact, pendingState as pending, recordEvent } from "../monitor.mjs";
import {
  COMPLETION_REASON,
  confirmPendingStop,
  EDITORIAL_LIMITS,
  fail,
  figureCalls,
  resetBudget,
  userTransition,
} from "./lifecycle.mjs";

// 누가 할 수 있는지·수정 한도에 세는지는 contracts/actions.mjs 카탈로그 · ADR-0006·FIGURE-001
const FIGURE_ACTIONS = [
  "request_figures",
  "select_figures",
  "approve_design",
  "revise_design",
  "revise_figures",
  "confirm_figures",
  "discard_figures",
];
const FIGURE_REVISIONS = ["revise_design", "revise_figures"];
function agentFeedbackRounds(events = []) {
  let rounds = 0;
  for (const event of events.toReversed()) {
    if (event.by !== "agent") {
      if (
        [
          "feedback",
          "complete_requirements",
          "satisfy",
          "authorize_publication",
          "approve_brief",
          "requested",
        ].includes(event.kind)
      )
        break;
      continue;
    }
    if (countsAsRound(event.kind)) rounds++;
  }
  return rounds;
}

export async function runAction(service, id, input, actor = "user") {
  if (!requestObjectSchema.safeParse(input).success) fail("요청 내용을 확인해 주세요.");
  const {
    operationId,
    expectedVersion,
    type,
    feedback,
    edit,
    figures,
    directions,
    routes,
    look,
    target,
  } = input;
  if (!actionIdentitySchema.safeParse(input).success) fail("지원하지 않는 요청입니다.");
  const changed = await service.locked(id, async () => {
    const run = service.store.get(id);
    const beforeStatus = run.state.status;
    const signature = JSON.stringify({
      expectedVersion,
      type,
      feedback,
      edit,
      figures,
      directions,
      routes,
      look,
      target,
    });
    if (Object.hasOwn(run.operations ?? {}, operationId)) {
      if (run.operations[operationId] !== signature)
        fail("같은 요청 번호의 내용이 달라졌습니다.", 409);
      return false;
    }
    if (!actionVersionSchema.safeParse(input).success || expectedVersion !== run.state.version)
      fail("다른 화면에서 작업이 변경됐습니다. 최신 내용을 확인해 주세요.", 409);
    if (["feedback", "revise_brief"].includes(type) && !feedbackSchema.safeParse(feedback).success)
      fail("수정할 내용을 입력해 주세요.");
    if (type === "approve_brief" && edit !== undefined && !briefEditSchema.safeParse(edit).success)
      fail("수정 해석 보정 내용을 확인해 주세요.");
    // 구성 승인·다시 구성·되돌림 입력 검사 · ADR-0026
    if (FIGURE_REVISIONS.includes(type) || type === "approve_design") {
      const request = actionRequestSchema.safeParse(input);
      if (!request.success)
        fail(
          type === "approve_design"
            ? `시각자료 방향은 후보마다 ${FIGURE_LIMITS.direction}자 이내로 적어 주세요.`
            : `시각자료 의견을 ${FIGURE_LIMITS.feedback}자 이내로 적고 대상을 골라 주세요.`,
        );
    }
    if (
      (type === "select_figures" || (type === "confirm_figures" && figures !== undefined)) &&
      !figureIdsSchema.safeParse(figures).success
    )
      fail("시각자료를 하나 이상 골라 주세요.");
    if (
      type === "select_figures" &&
      directions !== undefined &&
      !figureDirectionsSchema.safeParse(directions).success
    )
      fail(`시각자료 방향은 후보마다 ${FIGURE_LIMITS.direction}자 이내로 적어 주세요.`);
    if (
      type === "select_figures" &&
      routes !== undefined &&
      !figureRoutesSchema.safeParse(routes).success
    )
      fail("시각자료 경로를 확인해 주세요.");
    if (
      type === "select_figures" &&
      look !== undefined &&
      !figureLookSchema.safeParse(look).success
    )
      fail("그림 스타일을 확인해 주세요.");
    if (type === "select_figures") {
      for (const figureId of figures) {
        const candidate = run.state.figure.candidates.find((item) => item.id === figureId);
        const route = effectiveRoute({
          kind: candidate?.kind,
          route: routes?.[figureId] ?? candidate?.route,
        });
        // 연결되지 않은 경로는 다른 경로로 바꾸지 않고 거부한다(FIGURE-002)
        if (!service.figureRoutes.includes(route))
          fail(`${ROUTE_NAMES[route]} 경로가 아직 연결되지 않았습니다.`, 409);
      }
    }
    // 시각자료 위치 지시는 선택 입력 · 있으면 기본 배치 기준보다 우선
    if (
      type === "request_figures" &&
      feedback !== undefined &&
      !feedbackSchema.safeParse(feedback).success
    )
      fail("시각자료 위치 지시를 확인해 주세요.");
    if (!actionAllowed(type, actor))
      fail(`${actionSpec(type)?.summary}은 사람만 할 수 있습니다. 화면에서 확인해 주세요.`, 403);
    if (
      actor === "agent" &&
      countsAsRound(type) &&
      agentFeedbackRounds(run.events) >= EDITORIAL_LIMITS.agentFeedbackRounds
    )
      fail(
        `에이전트 수정 지시는 사람 확인 없이 ${EDITORIAL_LIMITS.agentFeedbackRounds}회까지입니다. 사람이 결과를 확인한 뒤 이어가 주세요.`,
        409,
      );
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
        ...(actor === "agent" ? { briefPreapproved: true } : {}),
      });
      run.pending = null;
      resetBudget(service, run);
    } else if (type === "approve_brief") {
      run.state = userTransition(run.state, {
        ...event,
        reviewedRevision: run.state.revision,
        ...(edit ? { edit } : {}),
      });
      run.pending = null;
    } else if (type === "revise_brief") {
      run.state = userTransition(run.state, {
        ...event,
        reviewedRevision: run.state.revision,
        note: feedback.trim(),
      });
      run.pending = null;
    } else if (["satisfy", "authorize_publication"].includes(type)) {
      run.state = userTransition(run.state, { ...event, reviewedRevision: run.state.revision });
    } else if (FIGURE_ACTIONS.includes(type)) {
      run.state = userTransition(run.state, {
        ...event,
        reviewedRevision: run.state.revision,
        ...(figures === undefined ? {} : { figures }),
        ...(["select_figures", "approve_design"].includes(type) && directions !== undefined
          ? { directions }
          : {}),
        ...(FIGURE_REVISIONS.includes(type) ? { feedback: feedback.trim() } : {}),
        ...(type === "revise_figures" ? { target } : {}),
        ...(type === "select_figures" && routes !== undefined ? { routes } : {}),
        ...(type === "select_figures" && look !== undefined ? { look } : {}),
        ...(type === "request_figures" && feedback !== undefined ? { note: feedback.trim() } : {}),
      });
      // AI를 부르는 요청(위치 제안·생성)만 새 실행 예산
      if (pending(run.state)) {
        run.pending = null;
        resetBudget(service, run, figureCalls(run.state));
      }
    } else {
      const state = run.state;
      if (["paused", "failed"].includes(state.status)) {
        run.state = userTransition(state, {
          ...event,
          type: state.status === "paused" ? "resume" : "retry",
        });
        run.pending = null;
        // 시각자료 생성을 이어가면 남은 (그림 × 층) 수만큼
        resetBudget(service, run, figureStage(run.state) ? figureCalls(run.state) : undefined);
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
      feedback: actor === "agent" ? "편집장 수정 요청" : "수정 요청",
      complete_requirements: "전체 요구사항 보완 요청",
      satisfy: "초안 확정",
      authorize_publication: "발행 준비 승인",
      approve_brief: edit ? "수정 해석 보정 승인" : "수정 해석 승인",
      revise_brief: "수정 해석 다시 요청",
      request_figures: "시각자료 추가 요청",
      select_figures: "시각자료 위치 선택",
      approve_design: "시각자료 구성 승인",
      revise_design: "시각자료 구성 다시 요청",
      revise_figures: target === "compose" ? "시각자료 다시 구성 요청" : "시각자료 부분 수정 요청",
      confirm_figures: "시각자료 확인",
      discard_figures: "시각자료 없이 진행",
      resume:
        beforeStatus === "failed"
          ? "실패 단계 재시도"
          : beforeStatus === "paused"
            ? "중단 작업 재개"
            : "진행 다시 연결",
    };
    recordEvent(run, service.now(), type, labels[type], {
      by: actor,
      ...(actionSpec(type)?.text ? { reason: feedback.trim() } : {}),
      ...(figures === undefined ? {} : { figures }),
    });
    run.operations = { ...run.operations, [operationId]: signature };
    service.save(run);
    return true;
  });
  return changed &&
    !["pause", "satisfy", "authorize_publication", "confirm_figures", "discard_figures"].includes(
      type,
    )
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
