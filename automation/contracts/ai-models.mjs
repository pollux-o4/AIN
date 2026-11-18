// AI 모델 목록 SSoT · 서비스 기본값·단계별 상향·화면 표시명이 같은 목록을 사용
// 2026-11-14: Flash 3.8 → Hydrogen 4 (low·medium·high 비교 후 기본 Medium, 검토·재작업 High)
export const AI_MODELS = Object.freeze({
  standard: Object.freeze({
    provider: "antigravity",
    model: "gemini-4-hydrogen-medium",
    label: "Hydrogen 4 Medium",
  }),
  high: Object.freeze({
    provider: "antigravity",
    model: "gemini-4-hydrogen-high",
    label: "Hydrogen 4 High",
  }),
});

// 같은 제공자 안에서 effort만 올린 짝 · 담당 세션은 유지하고 모델만 교체됨
/** @type {Map<string, {provider: string, model: string}>} */
const ESCALATIONS = new Map([[AI_MODELS.standard.model, AI_MODELS.high]]);

/** @param {{provider: string, model: string}} ai */
export function escalated(ai) {
  const target = ESCALATIONS.get(ai.model);
  return target && target.provider === ai.provider
    ? { provider: target.provider, model: target.model }
    : null;
}

/** @param {string} model */
export const modelLabel = (model) =>
  Object.values(AI_MODELS).find((entry) => entry.model === model)?.label ?? model;
