import { previousPart, readerLength, STAGES, standing } from "../editorial/domain/index.mjs";

// 프롬프트용 요구사항 목록 보기: 값과 근거 문장 · 출처·회차는 판단에 쓰지 않아 뺀다
const standingRequirements = (state) =>
  Object.fromEntries(
    Object.entries(standing(state)).map(([kind, { value, quote }]) => [kind, { value, quote }]),
  );

import { draftMetrics } from "./metrics.mjs";

// 시각자료: 확정된 초안과 글 설계(독자·가치·구성) · 생성은 사람이 고른 후보와 그 위치의 이유 · FIGURE-001
// 글을 먼저 완성하는 이유: 그림 담당이 글의 의도·흐름을 이어받아 그 지점에 필요한 그림을 그리게 함
function figureContext(state, action) {
  return {
    idea: state.idea,
    artifacts: {
      audience: state.artifacts.audience?.output,
      value: state.artifacts.value?.output,
      outline: state.artifacts.outline?.output,
      draft: { text: state.artifacts.draft.output.text },
    },
    ...(action.note ? { placementNote: action.note } : {}),
    // 위치 제안이 빠짐없이 검토할 단위(도입부·모든 소제목)
    ...(action.units ? { units: action.units } : {}),
    ...(action.candidates ? { candidates: action.candidates } : {}),
    ...(action.progress ? { progress: action.progress } : {}),
    ...(action.pass ? { pass: action.pass } : {}),
    // 앞 층 결과: svgFile(작업 폴더 파일)·alt·caption·notes
    ...(action.previous ? { previous: action.previous } : {}),
  };
}

// 단계가 입력으로 받는 앞 단계 산출물 · 검토는 이전 검토·주제를 받지 않음(독립 판정)
const STAGE_INPUTS = {
  diagnose: [],
  topic: ["diagnose"],
  audience: ["diagnose", "topic"],
  value: ["diagnose", "topic", "audience"],
  research: ["diagnose", "topic", "audience", "value"],
  outline: ["diagnose", "topic", "audience", "value", "research"],
  draft: ["diagnose", "topic", "audience", "value", "research", "outline"],
  review: ["diagnose", "audience", "value", "research", "outline", "draft"],
};

export function promptContext(state, action) {
  if (action.type === "request_figure") return figureContext(state, action);
  const route = action.type === "request_route";
  const stage = action.stage;
  const keys = route ? STAGES : STAGE_INPUTS[stage];
  const artifacts = Object.fromEntries(
    keys.filter((key) => state.artifacts[key]).map((key) => [key, state.artifacts[key].output]),
  );
  const previous = state.history.at(-1)?.artifacts;
  // 피드백 수정에 필요한 직전 대상만 전달; 전체 이력·중복 초고는 상태 저장소에 보존.
  // 고칠 대상은 복귀 단계의 직전 결과뿐 · 앞 단계를 다시 만들었으면 뒤 단계는 새 설계로 새로 씀
  // (이전 초고를 주면 구성 예산과 무관하게 길이가 끌려감)
  const editPoint = state.routeTarget ?? stage;
  const editing = !route && stage !== "review" && state.feedback && stage === editPoint;
  const section = action.section;
  // 구간별 초고: 기준본은 같은 순서의 이전 구간 · 연결을 위해 직전에 쓴 구간만 전달 · ADR-0009
  // 예산 초과로 거부된 구간은 그 원고를 줄이는 편집이 기준본
  // 변경 표시 수정은 직전 원고 전체가 기준본(표시를 적용할 대상) · ADR-0018
  const rejected = (section ?? action).rejected;
  const baseline = rejected
    ? rejected
    : action.mode === "edit"
      ? previous?.draft?.output?.text
      : !editing
        ? undefined
        : section
          ? previousPart(previous?.draft?.output?.text, section.index, section.total)
          : previous?.[stage]?.output;
  const lastPart = section ? state.draftParts?.at(-1)?.text : undefined;
  return {
    source: state.source,
    idea: state.idea,
    // 요구사항 목록: 지금 유효한 요구(최신 사람 지시가 반영됨) · 모든 단계의 유일한 요구 · ADR-0016
    ...(Object.keys(standingRequirements(state)).length
      ? { requirements: standingRequirements(state) }
      : {}),
    artifacts,
    // 편집 메모(route): 사람 피드백 해석 결과 · 구성·초고·검토가 같은 기준을 따름
    ...(state.brief && ["outline", "draft", "review"].includes(stage)
      ? { brief: state.brief }
      : {}),
    // 측정값: 검토는 현재 초고, 편집 메모는 직전 초고 기준
    ...((stage === "review" || route) && typeof artifacts.draft?.text === "string"
      ? {
          draftCharacterCount: readerLength(artifacts.draft.text),
          draftMetrics: draftMetrics(artifacts.draft.text, {
            outline: artifacts.outline,
            value: artifacts.value,
          }),
        }
      : {}),
    baseline,
    // 구간별 초고의 반려 사유는 구간(section.retryNote)에 실림
    ...(!section && state.retry && state.retry.stage === stage
      ? { retryNote: state.retry.note }
      : {}),
    ...(lastPart ? { previousSection: lastPart } : {}),
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
