// 그림 사이 일관성 계약: 위치 제안이 정한 공통 시각 규칙(style)과 반복 대상(motifs) · ADR-0022
// 코드는 이름을 글자 그대로 대조하고 세기만 한다(JUDGE-001)
import { FIGURE_LIMITS, FIGURE_STYLE_KEYS } from "../../contracts/figure.mjs";

function acceptStyle(style) {
  if (!style) return style;
  const rules = Object.fromEntries(FIGURE_STYLE_KEYS.map((key) => [key, style[key].trim()]));
  return style.look ? { look: style.look, ...rules } : rules;
}
// 이름이 겹치지 않는 대상만 상한까지
function acceptMotifs(motifs = []) {
  const accepted = [];
  for (const { name, look } of motifs) {
    const key = name.trim();
    if (accepted.some((motif) => motif.name === key)) continue;
    accepted.push({ name: key, look: look.trim() });
    if (accepted.length === FIGURE_LIMITS.motifs) break;
  }
  return accepted;
}
const uniqueNames = (names = []) => [...new Set(names.map((name) => name.trim()))];

// 받아들인 후보에 계약을 묶는다 · 계약에 없는 이름은 빼고, 실제로 두 후보 이상이 가리키는 대상만 남긴다
export function bindConsistency(output, candidates) {
  const declared = acceptMotifs(output.motifs);
  const bound = candidates.map(({ motifs, ...candidate }) => {
    const refs = uniqueNames(motifs).filter((name) => declared.some((m) => m.name === name));
    return refs.length ? { ...candidate, motifs: refs } : candidate;
  });
  const shared = (name) => bound.filter((c) => c.motifs?.includes(name)).length > 1;
  const style = acceptStyle(output.style);
  return {
    candidates: bound,
    motifs: declared.filter((motif) => shared(motif.name)),
    ...(style ? { style } : {}),
  };
}
// 그림 한 장 작업에 넘길 계약: 공통 규칙과 그 그림이 가리키는 반복 대상만
export function consistencyFor(figure, id) {
  const names = figure.candidates.find((c) => c.id === id)?.motifs ?? [];
  const motifs = (figure.motifs ?? []).filter((motif) => names.includes(motif.name));
  return {
    ...(figure.style ? { style: figure.style } : {}),
    ...(motifs.length ? { motifs } : {}),
  };
}
