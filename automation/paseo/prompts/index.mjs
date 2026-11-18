// 프롬프트 조립: 과업 종류별 정의(stages·route·figure)를 골라 공통 틀에 싣는다 · ADR-0013
import { promptContext } from "../context.mjs";
import { roleOf } from "../roles.mjs";
import { figureSpec } from "./figure.mjs";
import { frame } from "./frame.mjs";
import { routeSpec } from "./route.mjs";
import { stageSpec } from "./stages.mjs";

export { promptData, promptTask } from "./frame.mjs";

// 연결 확인: 글 과업과 무관하게 왕복만 확인
const pilotPrompt = (state) =>
  "실행 연결 확인만 수행한다. 도구, 파일, 쉘 및 다른 에이전트는 사용하지 않는다. 부가 설명 없이 다음 JSON 객체 하나만 반환한다: " +
  JSON.stringify({
    purpose: "연결 확인",
    audience: "운영자",
    sectionModes: ["test"],
    preserveVoice: "해당 없음",
    strategy: "연결만 확인",
    marker: state.articleId,
  });

const SPECS = {
  request_ai: stageSpec,
  request_route: () => routeSpec(),
  request_figure: (_state, action) => figureSpec(action),
};
const taskId = (action) => (action.type === "request_route" ? "route" : action.stage);

/**
 * @param {any} state 편집 상태
 * @param {{type: string, stage?: string, section?: any, pass?: string}} action nextAction 결과
 * @param {{pilot?: boolean}} [ai]
 * @param {{delta?: Record<string, unknown>, omitted?: string[]}} [reuse] 같은 세션에 이어 보낼 때의 새 자료
 */
export function buildPrompt(state, action, ai = {}, { delta, omitted } = {}) {
  if (ai.pilot) return pilotPrompt(state);
  const spec = SPECS[action.type];
  if (!spec) throw new Error("Unsupported prompt action");
  return frame({
    id: taskId(action),
    role: roleOf(action),
    ...spec(state, action),
    data: delta ?? promptContext(state, action),
    ...(delta ? { omitted: omitted ?? [] } : {}),
  });
}

// 형식 오류 재요청 · 원인만 알리고 원문은 다시 싣지 않음(세션이 직전 응답을 기억)
/** @param {unknown} error */
export function formatRetryPrompt(error) {
  const reason = String(error instanceof Error ? error.message : error).slice(0, 300);
  return [
    `직전 응답을 지정된 결과 형식으로 해석하지 못하였다: ${reason}`,
    "동일한 내용을 약속된 JSON 객체 하나로만 다시 반환한다. 앞뒤 설명, 코드 블록 표시 및 다른 JSON 객체는 포함하지 않는다.",
    '문자열 내부의 큰따옴표는 \\", 줄바꿈은 \\n, 역슬래시는 \\\\로 이스케이프하여 표기한다.',
  ].join("\n");
}
