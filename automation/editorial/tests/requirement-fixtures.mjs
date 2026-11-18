// 진단·편집 메모 AI 대역: 글감·피드백 문장의 분량 표현을 요구 변경으로 옮긴다(실제로는 LLM이 뜻을 읽음) · ADR-0016
import { parseLength } from "../domain/legacy-requirements.mjs";

export const lengthChanges = (/** @type {string} */ text) => {
  const value = parseLength(text);
  return value ? [{ kind: "length", op: "set", value, quote: text }] : [];
};

export const diagnoseFor = (/** @type {string} */ idea, /** @type {object} */ base) => ({
  ...base,
  requirementChanges: lengthChanges(idea ?? ""),
});
