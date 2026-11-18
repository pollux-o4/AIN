// 요구사항 목록: 사람 요구의 변경 기록을 항목별 최신 값으로 접는다 · 지금 유효한 요구의 유일한 원천 · ADR-0016

import { valueSchemaOf } from "../../contracts/requirements.mjs";
import { AUTO } from "../../contracts/writing-modes.mjs";
import { legacyChanges } from "./legacy-requirements.mjs";

/** @typedef {import("../../contracts/requirements.mjs").RequirementChange} RequirementChange */
/** @typedef {{ revision: number, source: string, changes: RequirementChange[] }} LogEntry */

// 값 형식을 통과한 변경만 남긴다 · 형식이 틀린 한 건 때문에 나머지를 버리지 않음
function validChanges(/** @type {unknown} */ changes) {
  if (!Array.isArray(changes)) return [];
  return changes.flatMap((change) => {
    if (!change || typeof change !== "object" || typeof change.kind !== "string") return [];
    const quote = typeof change.quote === "string" ? change.quote.trim() : "";
    if (change.op === "lift") return [{ kind: change.kind, op: "lift", quote }];
    if (change.op !== "set") return [];
    const parsed = valueSchemaOf(change.kind).safeParse(change.value);
    return parsed.success ? [{ kind: change.kind, op: "set", value: parsed.data, quote }] : [];
  });
}

/** 의뢰 화면·CLI 선택값 → 변경 · 'auto'는 요구가 아니다 */
export function formChanges(/** @type {Record<string, any>} */ direction = {}) {
  const changes = [];
  for (const kind of ["mode", "readerLevel"])
    if (direction[kind] && direction[kind] !== AUTO)
      changes.push({ kind, op: "set", value: direction[kind], quote: "의뢰 화면 선택" });
  if (direction.targetLength)
    changes.push({
      kind: "length",
      op: "set",
      value: direction.targetLength,
      quote: "의뢰 화면 선택",
    });
  return changes;
}

/** 기록 한 건 추가 · 유효한 변경이 없으면 남기지 않음 */
export function record(state, /** @type {string} */ source, /** @type {unknown} */ changes) {
  const valid = validChanges(changes);
  if (!valid.length) return;
  state.requirementLog = [
    ...(state.requirementLog ?? []),
    { revision: state.revision, source, changes: valid },
  ];
}

function legacyRequirementLog(state) {
  const changes = validChanges([...formChanges(state.direction), ...legacyChanges(state)]);
  return changes.length ? [{ revision: 1, source: "form", changes }] : [];
}

/** 요구사항 목록이 없던 이전 글은 첫 전이에서 한 번 만든다 */
export function ensureLog(state) {
  if (!Array.isArray(state.requirementLog)) state.requirementLog = legacyRequirementLog(state);
}

/**
 * 지금 유효한 요구 · 항목별로 가장 나중 변경이 이긴다(lift는 항목 삭제)
 * @returns {Record<string, { value: unknown, quote: string, source: string, revision: number }>}
 */
export function standing(state) {
  const log = Array.isArray(state?.requirementLog)
    ? state.requirementLog
    : legacyRequirementLog(state ?? {});
  /** @type {Record<string, any>} */
  const current = {};
  for (const entry of log)
    for (const change of entry.changes) {
      if (change.op === "lift") delete current[change.kind];
      else
        current[change.kind] = {
          value: change.value,
          quote: change.quote,
          source: entry.source,
          revision: entry.revision,
        };
    }
  return current;
}

/** 값만 · 코드 검사·예산 배정이 쓴다 */
export const requirementValue = (state, /** @type {string} */ kind) => standing(state)[kind]?.value;
