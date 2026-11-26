// AI 모델 목록 SSoT · 서비스 기본값·단계별 상향·화면 표시명이 같은 목록을 사용
// 2026-11-14: Flash 3.8 → Hydrogen 4 (low·medium·high 비교 후 기본 Medium, 검토·재작업 High)
// 2026-11-26: 제공자가 사고 단계를 모델 이름에서 분리함 · 모델 하나 + thinking(Paseo thinkingOptionId)으로 지정
export const AI_MODELS = Object.freeze({
  standard: Object.freeze({
    provider: "antigravity",
    model: "gemini-4-hydrogen",
    thinking: "medium",
    label: "Hydrogen 4 Medium",
  }),
  high: Object.freeze({
    provider: "antigravity",
    model: "gemini-4-hydrogen",
    thinking: "high",
    label: "Hydrogen 4 High",
  }),
});

/** @param {{model: string, thinking?: string}} ai */
const keyOf = (ai) => `${ai.model}:${ai.thinking ?? ""}`;

// 사고 단계를 모델 이름에 붙이던 이전 식별자 · 저장된 작업·실행 기록을 현재 형식으로 읽는다
/** @type {Map<string, {model: string, thinking: string}>} */
const LEGACY = new Map(
  /** @type {[string, {model: string, thinking: string}][]} */ ([
    ["gemini-4-hydrogen-medium", AI_MODELS.standard],
    ["gemini-4-hydrogen-high", AI_MODELS.high],
  ]),
);

/**
 * 이전 식별자를 현재 모델·사고 단계로 바꾼다 · 그 밖의 값은 그대로 둔다
 * @template {{model: string, thinking?: string}} T @param {T} ai @returns {T}
 */
export function currentModel(ai) {
  const entry = LEGACY.get(ai.model);
  return entry ? { ...ai, model: entry.model, thinking: entry.thinking } : ai;
}

// 같은 제공자 안에서 사고 단계만 올린 짝 · 담당 세션은 유지하고 사고 단계만 교체됨
const ESCALATIONS = new Map([[keyOf(AI_MODELS.standard), AI_MODELS.high]]);

/** @param {{provider: string, model: string, thinking?: string}} ai */
export function escalated(ai) {
  const target = ESCALATIONS.get(keyOf(currentModel(ai)));
  return target && target.provider === ai.provider
    ? { provider: target.provider, model: target.model, thinking: target.thinking }
    : null;
}

/** @param {{model: string, thinking?: string}} ai */
export const modelLabel = (ai) => {
  const current = currentModel(ai);
  return (
    Object.values(AI_MODELS).find((entry) => keyOf(entry) === keyOf(current))?.label ??
    current.model
  );
};
