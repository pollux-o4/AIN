// 코드로 판정하는 요구 · 상태 머신 review 완료 가드 · ADR-0007
// 요구 값은 요구사항 목록(ledger)이 원천 · 여기는 셀 수 있는 종류의 검사기만 등록(전략) · ADR-0016
// 확장: CHECKS에 kind별 { target(state→단계), evaluate(state, value) } 추가

import { splitArticle } from "../../contracts/article-structure.mjs";
import { standing } from "./ledger.mjs";
import { readerLength } from "./length.mjs";

export const AUTO_CORRECTION_LIMIT = 2;

// 도입·구간 단위 실제 글자 수 · 모델은 글자 수를 세지 못하므로 숫자로 제공
function sectionCounts(text) {
  const { lead, sections } = splitArticle(text);
  return [lead, ...sections].filter(Boolean).map(
    (part) =>
      `${part
        .split("\n")[0]
        .replace(/^#+\s*/, "")
        .slice(0, 30)} ${readerLength(part)}자`,
  );
}

// 분량: 처음엔 구성부터 예산 재배정, 예산이 이미 자동 재배정된 뒤에는 데스크처럼 초고를 잘라 맞춤(cut to fit) · RES-006
const lengthCheck = {
  target: (state) => (state.feedbackSource === "auto" ? "draft" : "outline"),
  evaluate(state, { min, max }) {
    const text = state.artifacts?.draft?.output?.text;
    if (typeof text !== "string") return null;
    const actual = readerLength(text);
    const over = max !== null && actual > max;
    if (!over && actual >= min) return null;
    const range = max === null ? `${min}자 이상` : `${min}~${max}자`;
    const goal = over ? Math.round((min + max) / 2) : min;
    const delta = Math.abs(actual - goal);
    const how = over
      ? `약 ${delta}자를 구간·예시 삭제로 줄인다(문장 다듬기로는 부족)`
      : `약 ${delta}자를 부족한 구간 설명·예시로 보강한다`;
    return {
      actual,
      required: { min, max },
      message: `요구사항 미충족(분량): ${actual}자 · 요구 ${range}. ${how}. 현재 구간별: ${sectionCounts(text).join(" / ")}.`,
    };
  },
};

/** @type {Record<string, { target: (state: any) => string, evaluate: (state: any, value: any) => any }>} */
const CHECKS = { length: lengthCheck };

// 지금 유효한 요구 값 · 프롬프트·예산 배정·검사가 같은 요구사항 목록을 읽는다
export function requirements(state) {
  return Object.fromEntries(
    Object.entries(standing(state)).map(([kind, entry]) => [kind, entry.value]),
  );
}

export function unmetRequirements(state) {
  return Object.entries(requirements(state)).flatMap(([kind, value]) => {
    const check = CHECKS[kind];
    const unmet = check?.evaluate(state, value);
    return unmet ? [{ kind, target: check.target(state), ...unmet }] : [];
  });
}

// 여러 미충족이면 가장 앞 단계로 되돌리고 지시문은 합침
export function correctionPlan(unmet, stages) {
  if (!unmet.length) return null;
  const target = unmet
    .map((u) => u.target)
    .sort((a, b) => stages.indexOf(a) - stages.indexOf(b))[0];
  return { target, message: unmet.map((u) => u.message).join("\n") };
}

// 만족 승인을 막는 미충족 · 코드로 판정한 요구사항만(검토 판정은 주관이라 제외) · 새 회차에서 unmet 초기화
export function blockingUnmet(state) {
  return (state.unmet ?? []).filter((u) => u.kind !== "review");
}
