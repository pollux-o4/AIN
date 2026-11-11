// 사용자 입력과 AI 결과의 계약만 처리; 파일·CMS·발행 부작용 없음.
import { stageOutputSchemas } from "../../contracts/ai-output.mjs";
import { DEFAULT_DIRECTION, directionSchema } from "../../contracts/writing-modes.mjs";

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
    if (state.status === "failed" && !["waiting_ai", "waiting_route"].includes(status))
      return "Invalid failed work status";
  }
  if (
    !["waiting_ai", "waiting_route", "awaiting_user", "satisfied", "publication_ready"].includes(
      status,
    )
  )
    return "Invalid editorial status";
  if (status !== "waiting_ai" && state.stage !== "review")
    return "Presented or routed work requires review stage";
  if (status === "waiting_route") {
    // 라우팅 전에는 직전 완료 revision 유지; 선택된 선행 결과만 route에서 승계.
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
    ["satisfied", "publication_ready"].includes(status) &&
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
  return null;
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
    };
  if (state.status === "waiting_route")
    return {
      type: "request_route",
      allowedStages: STAGES,
      feedback: state.feedback,
      revision: state.revision,
    };
  if (state.status === "publication_ready")
    return { type: "publication_adapter_required", revision: state.revision, executed: false };
  return { type: "wait_for_user", status: state.status, revision: state.revision };
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
    };
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
      for (const key of ["resumeStatus", "error", "feedback", "routeReason"]) delete state[key];
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
      outputValid(event.stage, event.output);
      state.artifacts[event.stage] = {
        revision: state.revision,
        output: structuredClone(event.output),
      };
      const next = (state.plan ?? STAGES).find(
        (stage) => STAGES.indexOf(stage) > STAGES.indexOf(event.stage),
      );
      if (next) ai(state, next);
      else state.status = "awaiting_user";
      break;
    }
    case "feedback":
      requireThat(
        ["awaiting_user", "satisfied", "publication_ready"].includes(state.status),
        "Feedback requires a presented result",
      );
      requireThat(
        event.reviewedRevision === state.revision && isText(event.feedback),
        "Feedback must reference current revision",
      );
      state.history.push({
        plan: [...(state.plan ?? STAGES)],
        revision: state.revision,
        artifacts: structuredClone(state.artifacts),
        feedback: event.feedback,
      });
      state.revision += 1;
      state.feedback = event.feedback;
      state.approval = null;
      state.satisfiedRevision = null;
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
      // 복귀 단계 이후 산출물 무효화 · 원문과 이전 산출물은 history에 보존.
      const index = STAGES.indexOf(event.target);
      const prefix = STAGES.slice(0, index);
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
      state.routeReason = event.reason;
      ai(state, event.target);
      break;
    }
    case "satisfy":
      requireThat(
        state.status === "awaiting_user" && event.reviewedRevision === state.revision,
        "Satisfaction requires current presented revision",
      );
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
      state.approval = { revision: state.revision, eventId: event.id };
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
        ["waiting_ai", "waiting_route"].includes(state.status) && isText(event.error),
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
      throw new Error(`Unsupported event: ${event.type}`);
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
