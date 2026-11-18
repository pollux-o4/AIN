// 사용자 입력과 AI 결과의 계약만 처리; 파일·CMS·발행 부작용 없음.
import { stageOutputSchemas } from "../../contracts/ai-output.mjs";
import { DEFAULT_DIRECTION, directionSchema } from "../../contracts/writing-modes.mjs";
import { acceptEdits, marksChanges } from "./edits.mjs";
import {
  FIGURE_AWAITING,
  FIGURE_USER_EVENTS,
  FIGURE_WAITING,
  figureAction,
  figureIssue,
  figureStage,
  figureTransition,
} from "./figures.mjs";
import { ensureLog, formChanges, record } from "./ledger.mjs";
import {
  AUTO_CORRECTION_LIMIT,
  blockingUnmet,
  correctionPlan,
  unmetRequirements,
} from "./requirements.mjs";
import { acceptOutline, acceptPart, acceptWhole, currentSection } from "./sections.mjs";

export const STAGES = Object.freeze(Object.keys(stageOutputSchemas));
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const fullPlan = (plan) =>
  Array.isArray(plan) &&
  plan.length === STAGES.length &&
  STAGES.every((stage, i) => plan[i] === stage);
const isText = (value) => typeof value === "string" && value.trim().length > 0;
function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}
function ai(state, stage) {
  state.status = "waiting_ai";
  state.stage = stage;
  // 초고 단계에 새로 들어오면 구간 진행 초기화 · ADR-0009
  delete state.draftParts;
  delete state.retry;
}
function outputValid(stage, output) {
  const schema = stageOutputSchemas[stage];
  requireThat(schema, "Unknown editorial stage");
  schema.parse(output);
}
function artifactsIssue(artifacts, stages, revision) {
  if (!isRecord(artifacts)) return "Artifacts must be an object";
  for (const stage of stages) {
    const artifact = Object.hasOwn(artifacts, stage) ? artifacts[stage] : null;
    if (!isRecord(artifact)) return `Missing prerequisite artifact: ${stage}`;
    if (artifact.revision !== revision) return `Wrong revision for prerequisite artifact: ${stage}`;
    try {
      outputValid(stage, artifact.output);
    } catch (error) {
      return `Invalid prerequisite artifact: ${stage}: ${error.message}`;
    }
  }
  return null;
}
export function currentArtifact(state, stage) {
  return isRecord(state) &&
    Number.isSafeInteger(state.revision) &&
    state.revision > 0 &&
    STAGES.includes(stage) &&
    !artifactsIssue(state.artifacts, [stage], state.revision)
    ? state.artifacts[stage]
    : null;
}
function sameSnapshot(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const keys = Object.keys(left);
  return (
    Array.isArray(left) === Array.isArray(right) &&
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameSnapshot(left[key], right[key]))
  );
}
export function flowIssue(state) {
  try {
    return contractIssue(state);
  } catch {
    return "Invalid state contract";
  }
}
function contractIssue(state) {
  if (
    !isRecord(state) ||
    state.schemaVersion !== 1 ||
    !Number.isSafeInteger(state.version) ||
    state.version < 1 ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 1 ||
    !isText(state.articleId) ||
    typeof state.source !== "string" ||
    typeof state.idea !== "string" ||
    !(isText(state.source) || isText(state.idea)) ||
    !Array.isArray(state.history) ||
    !isRecord(state.seen)
  )
    return "Invalid state envelope";
  if (state.direction !== undefined && !directionSchema.safeParse(state.direction).success)
    return "Invalid editorial direction";
  if (!fullPlan(state.plan === undefined ? STAGES : state.plan))
    return "Invalid editorial plan: full STAGES required";
  if (!STAGES.includes(state.stage)) return "Invalid editorial stage";
  let status = state.status;
  if (["paused", "failed"].includes(status)) {
    status = state.resumeStatus;
    if (["paused", "failed"].includes(status)) return "Invalid resume status";
    if (
      state.status === "failed" &&
      !["waiting_ai", "waiting_route", FIGURE_WAITING].includes(status)
    )
      return "Invalid failed work status";
  }
  if (
    ![
      "waiting_ai",
      "waiting_route",
      "awaiting_brief",
      "awaiting_user",
      "satisfied",
      "publication_ready",
      FIGURE_WAITING,
      ...FIGURE_AWAITING,
    ].includes(status)
  )
    return "Invalid editorial status";
  if (status !== "waiting_ai" && state.stage !== "review")
    return "Presented or routed work requires review stage";
  if (status === "waiting_route" || status === "awaiting_brief") {
    // 라우팅·해석 승인 전에는 직전 완료 revision 유지; 선택된 선행 결과만 route에서 승계.
    const previous = state.history.at(-1);
    if (!isRecord(previous) || previous.revision !== state.revision - 1)
      return "Missing prior complete revision for feedback route";
    const previousPlan = previous.plan === undefined ? STAGES : previous.plan;
    if (!fullPlan(previousPlan)) return "Prior revision requires full STAGES";
    const issue =
      artifactsIssue(previous.artifacts, STAGES, previous.revision) ||
      artifactsIssue(state.artifacts, STAGES, previous.revision);
    if (issue) return issue;
    for (const stage of STAGES)
      if (!sameSnapshot(state.artifacts[stage], previous.artifacts[stage]))
        return `Feedback prerequisite differs from prior revision: ${stage}`;
    return null;
  }
  const required = status === "waiting_ai" ? STAGES.slice(0, STAGES.indexOf(state.stage)) : STAGES;
  const issue = artifactsIssue(state.artifacts, required, state.revision);
  if (issue) return issue;
  if (
    ["satisfied", "publication_ready", FIGURE_WAITING, ...FIGURE_AWAITING].includes(status) &&
    state.satisfiedRevision !== state.revision
  )
    return "Satisfaction must reference current revision";
  if (
    status === "publication_ready" &&
    (!isRecord(state.approval) ||
      state.approval.revision !== state.revision ||
      !isText(state.approval.eventId))
  )
    return "Publication approval must reference current revision";
  return figureIssue(state, status);
}
// 진행 중(또는 멈춘) AI 작업의 단계 키: 수정 해석·시각자료 작업은 편집 단계와 별개 이름
export function workStage(state) {
  return figureStage(state) ?? (state.status === "waiting_route" ? "route" : state.stage);
}
export function nextAction(state) {
  const reason = flowIssue(state);
  if (reason) return { type: "requirements_required", revision: state?.revision, reason };
  if (state.status === "waiting_ai")
    return {
      type: "request_ai",
      stage: state.stage,
      revision: state.revision,
      feedback: state.feedback ?? null,
      ...draftShape(state),
    };
  if (state.status === "waiting_route")
    return {
      type: "request_route",
      allowedStages: STAGES,
      feedback: state.feedback,
      revision: state.revision,
    };
  if (state.status === FIGURE_WAITING) return figureAction(state);
  if (state.status === "publication_ready")
    return { type: "publication_adapter_required", revision: state.revision, executed: false };
  return { type: "wait_for_user", status: state.status, revision: state.revision };
}
// 초고 작업의 모양: 변경 표시(문장 편집·교열 수정) · 구간별 작성 · 한 번에 작성 · ADR-0009·0018
function draftShape(state) {
  if (state.stage !== "draft") return {};
  if (marksChanges(state))
    return {
      mode: "edit",
      ...(state.retry?.stage === "draft" ? { retryNote: state.retry.note } : {}),
    };
  const section = currentSection(state);
  if (section) return { section };
  const retry = state.retry?.stage === "draft" ? state.retry : null;
  return retry ? { retryNote: retry.note, rejected: retry.rejected } : {};
}
// 새 수정 회차: 현재 결과를 이력에 보존하고 수정 지시를 건다
// source: person(사용자·편집장) | auto(요구사항 가드) · 이력에 함께 보존
function beginRevision(state, feedback, source) {
  state.history.push({
    plan: [...(state.plan ?? STAGES)],
    revision: state.revision,
    artifacts: structuredClone(state.artifacts),
    feedback,
    feedbackSource: source,
    // 본문이 바뀌면 앵커가 무효 · 만든 시각자료는 이력에만 남김
    ...(state.figure ? { figure: state.figure } : {}),
  });
  delete state.figure;
  state.revision += 1;
  state.feedback = feedback;
  state.feedbackSource = source;
  // 사람 피드백은 새 편집 메모로 해석 · 자동 보정은 같은 메모 기준 유지
  if (source === "person") delete state.brief;
  state.approval = null;
  state.satisfiedRevision = null;
  delete state.unmet;
}
// 복귀 단계 이후 산출물 무효화 · 원문과 이전 산출물은 history에 보존.
function routeTo(state, target, reason) {
  const prefix = STAGES.slice(0, STAGES.indexOf(target));
  requireThat(
    !artifactsIssue(state.artifacts, prefix, state.revision - 1),
    "Requirements contract incomplete for route prerequisites",
  );
  state.artifacts = Object.fromEntries(
    prefix.map((stage) => [
      stage,
      {
        ...state.artifacts[stage],
        revision: state.revision,
        reusedFromRevision: state.artifacts[stage].revision,
      },
    ]),
  );
  state.plan = [...STAGES];
  state.routeReason = reason;
  state.routeTarget = target;
  ai(state, target);
}
// 확정된 편집 메모로 수정 착수 · 해석한 요구 변경을 장부에 반영 · ADR-0010·0016
function startBrief(state) {
  record(state, "feedback", state.brief.requirementChanges);
  routeTo(state, state.brief.target, state.brief.intent);
}
// 편집 수준이 복귀 범위를 정함: 구조 편집은 늦어도 구성부터, 문장·교열은 초고부터 · RES-006
function levelTarget(target, level) {
  if (level === "line" || level === "copy") return "draft";
  if (level === "developmental" && STAGES.indexOf(target) > STAGES.indexOf("outline"))
    return "outline";
  return target;
}
// 검토 합격 판정(데스크 체크) → 미충족 항목 · 형식은 코드 판정과 같음
function reviewVerdict(state) {
  const review = state.artifacts.review?.output;
  if (review?.verdict !== "revise") return [];
  const from = ["outline", "draft"].includes(review.reviseFrom) ? review.reviseFrom : "draft";
  const criteria = review.unmetCriteria?.length ? review.unmetCriteria : review.findings;
  return [{ kind: "review", target: from, message: `검토 판정 미충족: ${criteria.join(" / ")}` }];
}
// review 완료 가드: 코드로 판정한 요구사항 미충족이면 상한 안에서 구성부터 다시 · ADR-0007
function presentOrCorrect(state) {
  const unmet = [...unmetRequirements(state), ...reviewVerdict(state)];
  const plan = correctionPlan(unmet, STAGES);
  if (plan && (state.autoCorrections ?? 0) < AUTO_CORRECTION_LIMIT) {
    beginRevision(state, plan.message, "auto");
    state.autoCorrections = (state.autoCorrections ?? 0) + 1;
    routeTo(state, plan.target, plan.message);
    return;
  }
  state.status = "awaiting_user";
  if (unmet.length) state.unmet = unmet;
}
export function transition(current, event) {
  requireThat(event && isText(event.id), "Event id required");
  const userEvents = [
    "start",
    "feedback",
    "complete_requirements",
    "satisfy",
    "authorize_publication",
    "pause",
    "resume",
    "retry",
    "approve_brief",
    "revise_brief",
    ...FIGURE_USER_EVENTS,
  ];
  requireThat(
    event.actor === (userEvents.includes(event.type) ? "user" : "adapter"),
    "Event actor does not match responsibility",
  );
  if (!current) {
    requireThat(event.type === "start", "First event must be start");
    requireThat(
      isText(event.articleId) && (isText(event.source) || isText(event.idea)),
      "Article id and source or idea required",
    );
    const plan = event.plan === undefined ? STAGES : event.plan;
    requireThat(fullPlan(plan), "Invalid editorial plan: full STAGES required");
    requireThat(
      (event.source === undefined || typeof event.source === "string") &&
        (event.idea === undefined || typeof event.idea === "string"),
      "Source and idea must be text",
    );
    const state = {
      plan: [...plan],
      schemaVersion: 1,
      articleId: event.articleId,
      version: 1,
      revision: 1,
      status: "waiting_ai",
      stage: "diagnose",
      source: event.source ?? "",
      idea: event.idea ?? "",
      direction: directionSchema.parse(
        event.direction === undefined ? DEFAULT_DIRECTION : event.direction,
      ),
      artifacts: {},
      history: [],
      seen: { [event.id]: JSON.stringify(event) },
      approval: null,
      satisfiedRevision: null,
      requirementLog: [],
    };
    record(state, "form", formChanges(state.direction));
    return { state, action: nextAction(state) };
  }
  const serialized = JSON.stringify(event);
  if (isRecord(current.seen) && Object.hasOwn(current.seen, event.id)) {
    requireThat(current.seen[event.id] === serialized, "Event id reused with different content");
    return { state: structuredClone(current), action: nextAction(current), duplicate: true };
  }
  requireThat(
    current.schemaVersion === 1 &&
      Number.isSafeInteger(current.version) &&
      current.version > 0 &&
      Number.isSafeInteger(current.revision) &&
      current.revision > 0 &&
      Array.isArray(current.history) &&
      isRecord(current.seen),
    "Invalid state envelope",
  );
  requireThat(event.expectedVersion === current.version, "Stale state version");
  const issue = flowIssue(current);
  requireThat(
    !issue || ["complete_requirements", "pause", "fail"].includes(event.type),
    `Requirements contract incomplete: ${issue}`,
  );
  const state = structuredClone(current);
  ensureLog(state);
  const before = state.status;
  switch (event.type) {
    case "complete_requirements": {
      requireThat(issue, "Requirements completion requires an incomplete state");
      requireThat(
        isText(state.articleId) &&
          typeof state.source === "string" &&
          typeof state.idea === "string" &&
          (isText(state.source) || isText(state.idea)),
        "Article id and source or idea required",
      );
      const snapshot = { ...state };
      delete snapshot.history;
      delete snapshot.seen;
      state.history.push(snapshot);
      state.revision += 1;
      state.plan = [...STAGES];
      state.artifacts = {};
      state.approval = null;
      state.satisfiedRevision = null;
      for (const key of ["resumeStatus", "error", "feedback", "routeReason", "figure"])
        delete state[key];
      ai(state, "diagnose");
      break;
    }
    case "complete": {
      requireThat(
        state.status === "waiting_ai" &&
          event.stage === state.stage &&
          event.revision === state.revision,
        "Unexpected or stale AI result",
      );
      let output = structuredClone(event.output);
      const marked = event.stage === "draft" && marksChanges(state);
      if (marked) {
        requireThat(event.mode === "edit", "Unexpected or stale draft edit");
        output = acceptEdits(state, output);
        if (!output) break; // 표시가 어긋나면 같은 단계에서 다시 · 반복이면 failed
      }
      outputValid(event.stage, output);
      if (event.stage === "draft" && !marked) {
        const section = currentSection(state);
        if (section)
          requireThat(event.section === section.index, "Unexpected or stale draft section");
        // 구간별: 다음(또는 다시 쓸) 구간 대기 · 한 번에: 형식 위반이면 다시 · 반복이면 failed
        output = section ? acceptPart(state, output) : acceptWhole(state, output);
        if (!output) break;
      }
      if (event.stage === "outline" && !acceptOutline(state, output)) break; // 예산 검증 · ADR-0009
      state.artifacts[event.stage] = { revision: state.revision, output };
      // 글감 문장의 요구는 한 번만 장부에 · 다시 진단해도 그 뒤의 피드백 변경을 덮지 않음 · ADR-0016
      if (event.stage === "diagnose" && !state.requirementLog.some((e) => e.source === "idea"))
        record(state, "idea", output.requirementChanges);
      const next = (state.plan ?? STAGES).find(
        (stage) => STAGES.indexOf(stage) > STAGES.indexOf(event.stage),
      );
      if (next) ai(state, next);
      else presentOrCorrect(state);
      break;
    }
    case "feedback":
      requireThat(
        ["awaiting_user", "satisfied", "publication_ready", ...FIGURE_AWAITING].includes(
          state.status,
        ),
        "Feedback requires a presented result",
      );
      requireThat(
        event.reviewedRevision === state.revision && isText(event.feedback),
        "Feedback must reference current revision",
      );
      beginRevision(state, event.feedback, "person");
      state.autoCorrections = 0;
      // 편집장(에이전트) 지시는 지시자 본인이 해석을 확정 · 사람 지시만 해석 승인 대기 · ADR-0010
      state.briefPreapproved = event.briefPreapproved === true;
      state.status = "waiting_route";
      break;
    case "route": {
      requireThat(
        state.status === "waiting_route" && event.revision === state.revision,
        "Unexpected or stale route",
      );
      requireThat(
        STAGES.includes(event.target) && isText(event.reason),
        "Route must choose diagnose or an editorial stage with a reason",
      );
      // 편집 메모는 사람 승인 전까지 제안 · 수정 착수는 approve_brief에서 · ADR-0010
      const brief = { intent: event.reason, ...(isRecord(event.brief) ? event.brief : {}) };
      state.brief = { ...brief, target: levelTarget(event.target, brief.level) };
      if (state.briefPreapproved) startBrief(state);
      else state.status = "awaiting_brief";
      break;
    }
    case "approve_brief": {
      requireThat(
        state.status === "awaiting_brief" && event.reviewedRevision === state.revision,
        "Brief approval requires the current proposed brief",
      );
      const edit = isRecord(event.edit) ? event.edit : {};
      requireThat(
        edit.target === undefined || STAGES.includes(edit.target),
        "Brief target must be an editorial stage",
      );
      state.brief = { ...state.brief, ...edit, approvedBy: "user" };
      startBrief(state);
      break;
    }
    case "revise_brief":
      requireThat(
        state.status === "awaiting_brief" &&
          event.reviewedRevision === state.revision &&
          isText(event.note),
        "Brief revision requires the current proposed brief and a note",
      );
      // 해석 보정 의견을 수정 요청에 덧붙여 다시 해석 · 이전 제안은 폐기
      state.feedback = `${state.feedback}\n\n해석 보정: ${event.note}`;
      delete state.brief;
      state.status = "waiting_route";
      break;
    case "satisfy":
      requireThat(
        state.status === "awaiting_user" && event.reviewedRevision === state.revision,
        "Satisfaction requires current presented revision",
      );
      requireThat(!blockingUnmet(state).length, "Satisfaction blocked by unmet requirements");
      state.satisfiedRevision = state.revision;
      state.status = "satisfied";
      break;
    case "authorize_publication":
      requireThat(
        state.status === "satisfied" &&
          state.satisfiedRevision === state.revision &&
          event.reviewedRevision === state.revision,
        "Separate approval for current satisfied revision required",
      );
      // 승인 대상은 넘길 결과물 전체: 본문 + 확인된 시각자료(없으면 본문만) · FIGURE-001
      state.approval = {
        revision: state.revision,
        eventId: event.id,
        figures: state.figure?.items.map((item) => item.id) ?? [],
      };
      state.status = "publication_ready";
      break;
    case "pause":
      requireThat(!["paused", "failed"].includes(state.status), "Already paused or failed");
      state.resumeStatus = state.status;
      state.status = "paused";
      break;
    case "resume":
      requireThat(state.status === "paused", "Not paused");
      state.status = state.resumeStatus;
      delete state.resumeStatus;
      break;
    case "fail":
      requireThat(
        ["waiting_ai", "waiting_route", FIGURE_WAITING].includes(state.status) &&
          isText(event.error),
        "Failure must reference pending AI work",
      );
      requireThat(
        event.revision === state.revision && event.stage === state.stage,
        "Stale failure",
      );
      state.resumeStatus = state.status;
      state.status = "failed";
      state.error = event.error;
      break;
    case "retry":
      requireThat(state.status === "failed", "Retry requires failure");
      state.status = state.resumeStatus;
      delete state.resumeStatus;
      delete state.error;
      break;
    default:
      if (!figureTransition(state, event)) throw new Error(`Unsupported event: ${event.type}`);
  }
  const resultingIssue = flowIssue(state);
  requireThat(
    !resultingIssue || ["pause", "fail"].includes(event.type),
    `Requirements contract incomplete: ${resultingIssue}`,
  );
  state.version += 1;
  Object.defineProperty(state.seen, event.id, {
    value: serialized,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  state.lastTransition = { event: event.type, from: before, to: state.status };
  return { state, action: nextAction(state) };
}
