// 변경 표시 수정: 문장 편집·교열(line·copy)은 원고를 다시 쓰지 않고 표시한 곳만 바꾼다 · ADR-0018
// 편집 수준이 결과물의 모양을 정한다(구조 편집 = 새 원고 · 문장 편집·교열 = 원고 위 변경 표시)
import { draftEditSchema } from "../../contracts/ai-output.mjs";
import { reject } from "./sections.mjs";

const MARKED_LEVELS = ["line", "copy"];

/** 직전 회차의 원고 · 변경 표시가 적용될 기준본 */
const baselineText = (state) => state.history?.at(-1)?.artifacts?.draft?.output?.text;

/** 이번 초고 작업이 변경 표시로 결과를 내는가 · 초고부터 다시 하는 문장 편집·교열 회차 */
export function marksChanges(state) {
  return (
    state.stage === "draft" &&
    state.routeTarget === "draft" &&
    MARKED_LEVELS.includes(state.brief?.level) &&
    typeof baselineText(state) === "string"
  );
}

// find는 기준본에 글자 그대로 한 번만 있어야 하고 서로 겹치지 않아야 한다 · 위반 목록 반환
function locate(text, edits) {
  const issues = [];
  const spans = [];
  for (const [index, { find }] of edits.entries()) {
    const at = text.indexOf(find);
    if (at < 0) issues.push(`${index + 1}번 find가 baseline에 없다`);
    else if (text.indexOf(find, at + 1) >= 0)
      issues.push(
        `${index + 1}번 find가 baseline에 여러 번 나온다(앞뒤를 더 포함해 한 곳만 가리킨다)`,
      );
    else spans.push({ index, start: at, end: at + find.length });
  }
  spans.sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i += 1)
    if (spans[i].start < spans[i - 1].end)
      issues.push(`${spans[i - 1].index + 1}번과 ${spans[i].index + 1}번 find가 겹친다`);
  return { issues, spans };
}

// 표시가 바꾼 자리에서 카드 문장의 새 값을 얻는다 · 글자 대조만 · 얻을 수 없으면 null
function editedValue(value, edits) {
  for (const { find, replace } of edits) {
    if (value.includes(find)) return value.replace(find, replace);
    const at = find.indexOf(value);
    if (at < 0) continue;
    const before = find.slice(0, at);
    const after = find.slice(at + value.length);
    if (
      replace.length >= before.length + after.length &&
      replace.startsWith(before) &&
      replace.endsWith(after)
    )
      return replace.slice(before.length, replace.length - after.length).trim() || null;
  }
  return null;
}
// 승인된 수정은 계획에도 반영된다: 카드(구성·약속)에서 온 문장이 표시로 바뀌면 카드도 같은 값으로
// 그렇지 않으면 카드 대조 검사가 사람이 승인한 수정을 누락으로 오판한다
function syncCards(state, before, after, edits) {
  const sync = (node) => {
    if (typeof node === "string") {
      if (!before.includes(node) || after.includes(node)) return node;
      return editedValue(node, edits) ?? node;
    }
    if (Array.isArray(node)) return node.map(sync);
    if (node && typeof node === "object")
      return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, sync(value)]));
    return node;
  };
  for (const stage of ["outline", "value"]) {
    const artifact = state.artifacts?.[stage];
    if (artifact?.output) state.artifacts[stage] = { ...artifact, output: sync(artifact.output) };
  }
}

/** 변경 표시를 기준본에 적용 · 표시가 어긋나면 거부(다시 또는 실패) 후 null */
export function acceptEdits(state, output) {
  const { edits, changeSummary } = draftEditSchema.parse(output);
  const text = baselineText(state);
  const { issues, spans } = locate(text, edits);
  if (issues.length) {
    const note = `변경 표시를 적용하지 못하였다: ${issues.join(" / ")}.`;
    reject(state, "draft", { index: -1, note, error: `변경 표시 적용 실패가 반복됨: ${note}` });
    return null;
  }
  delete state.retry;
  let result = text;
  for (const { index, start, end } of [...spans].reverse())
    result = result.slice(0, start) + edits[index].replace + result.slice(end);
  syncCards(state, text, result, edits);
  return {
    text: result,
    changeSummary,
    edits: edits.map(({ find, replace }) => ({ find, replace })),
  };
}
