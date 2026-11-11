import { STAGES } from "../editorial/domain/index.mjs";

export function promptContext(state, action) {
  const dependencies = {
    diagnose: [],
    topic: ["diagnose"],
    audience: ["diagnose", "topic"],
    value: ["diagnose", "topic", "audience"],
    research: ["diagnose", "topic", "audience", "value"],
    outline: ["diagnose", "topic", "audience", "value", "research"],
    draft: ["diagnose", "topic", "audience", "value", "research", "outline"],
    review: ["diagnose", "audience", "value", "research", "outline", "draft"],
  };
  const route = action.type === "request_route";
  const stage = action.stage;
  const keys = route ? STAGES : dependencies[stage];
  const artifacts = Object.fromEntries(
    keys.filter((key) => state.artifacts[key]).map((key) => [key, state.artifacts[key].output]),
  );
  const previous = state.history.at(-1)?.artifacts;
  // 피드백 수정에 필요한 직전 대상만 전달; 전체 이력·중복 초고는 상태 저장소에 보존.
  const baseline =
    !route && stage !== "review" && state.feedback && previous?.[stage]
      ? previous[stage].output
      : undefined;
  return {
    source: state.source,
    idea: state.idea,
    ...(state.direction ? { direction: state.direction } : {}),
    artifacts,
    ...(stage === "review" && typeof artifacts.draft?.text === "string"
      ? { draftCharacterCount: Array.from(artifacts.draft.text).length }
      : {}),
    baseline,
    feedback: state.feedback ?? undefined,
  };
}

export function summarizeInputs(context) {
  return {
    source: Boolean(context.source),
    feedback: Boolean(context.feedback),
    stages: Object.keys(context.artifacts),
    baseline: Boolean(context.baseline),
  };
}
