import { AI_MODELS, escalated } from "../../contracts/ai-models.mjs";
import { figureStage, passOf } from "../domain/figures.mjs";

// 작업별 AI 선택 정책 · 규칙(Strategy)을 우선순위대로 적용하고 처음 맞는 규칙의 모델을 쓴다
export const DEFAULT_AI = Object.freeze({
  provider: AI_MODELS.standard.provider,
  model: AI_MODELS.standard.model,
  enabled: true,
  maxDurationMs: 300000,
});

// 시각자료 담당 모델: 위치 제안·구성과 생성 층(그리기)·국소 수정 · ADR-0011·ADR-0026 · 2026-11-17 사용자 결정으로 Hydrogen High 일원화(ADR-0017)
// AIN_FIGURE_AI_<PLAN|DRAW|FIX>="provider/model:thinking@mode"로 층별 교체
// mode를 안 주면 provider 기본 모드(Jobs가 Paseo defaultModeId로 채움)
const HYDROGEN_HIGH = `${AI_MODELS.high.provider}/${AI_MODELS.high.model}`;
const FIGURE_AI_DEFAULTS = {
  plan: HYDROGEN_HIGH,
  draw: HYDROGEN_HIGH,
  fix: HYDROGEN_HIGH,
};
function parseAi(spec) {
  const match = /^([\w-]+)\/([^:@\s]+)(?::([\w-]+))?(?:@([\w-]+))?$/.exec(spec.trim());
  if (!match) throw new Error("AIN_FIGURE_AI_* must be provider/model[:thinking][@mode]");
  const [, provider, model, thinking, mode] = match;
  return { provider, model, ...(thinking ? { thinking } : {}), ...(mode ? { mode } : {}) };
}
const FIGURE_AI = Object.freeze(
  Object.fromEntries(
    Object.entries(FIGURE_AI_DEFAULTS).map(([role, spec]) => [
      role,
      parseAi(process.env[`AIN_FIGURE_AI_${role.toUpperCase()}`] ?? spec),
    ]),
  ),
);

// 시각자료 작업이면 그 단계·층의 모델
const figureRule = (state) => {
  const stage = figureStage(state);
  if (!stage) return null;
  return FIGURE_AI[stage === "figure" ? passOf(state.figure) : "plan"];
};
// 첫 초안까지는 기본 · 검토·다시 쓰기·피드백 반영은 같은 제공자의 상위 effort
// 모델 전환 턴은 제공자 캐시가 0(2026-11-14 실측) · 재작업 품질을 위해 비용 수용(사용자 결정)
const reworkRule = (state, base) =>
  state.stage === "review" || state.retry || state.feedback ? escalated(base) : null;

const RULES = [figureRule, reworkRule];

/**
 * 이번 작업에 덮어쓸 모델 필드(provider·model 등). 해당 규칙이 없으면 빈 값(작업 기본 모델 유지).
 * @param {Record<string, any>} state
 * @param {{provider: string, model: string}} base 작업 생성 시 고른 모델
 */
export function aiFor(state, base) {
  for (const rule of RULES) {
    const ai = rule(state, base);
    if (ai) return ai;
  }
  return {};
}
