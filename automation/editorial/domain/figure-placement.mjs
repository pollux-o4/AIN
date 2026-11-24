// 본문 속 그림 자리 · 본문 글자를 바꾸지 않고 앵커 문단 뒤에 놓을 자리와 그 상태를 계산한다 · FIGURE-001
import { currentOf } from "./figure-progress.mjs";

// 본문에 놓인 그림 · 그림 파일 제공과 본문 표시가 같은 자리 규칙(figureSpots)을 쓴다
export const placedFigures = (state) =>
  figureSpots(state.figure).flatMap((spot) => (spot.item ? [spot.item] : []));
// 본문을 바꾸지 않고 앵커 문장이 든 문단 뒤에 끼울 자리를 계산 → [{text} | {figure}] 순서열
// 문단 경계는 빈 줄 · 코드 블록(```) 안에서는 끊지 않음
// 코드 블록 경계(```로 시작하는 줄) 위치를 한 번만 색인하고, 어느 지점 앞의 경계 수는 이진 탐색으로 센다
// 문단마다 앞부분 전체를 다시 훑지 않게(그림 k개·문단 p개에서 O(k·p·n) → O(n + k·p·log f))
function fenceCounter(text) {
  const fences = Array.from(text.matchAll(/^```/gm), (match) => match.index);
  return (end) => {
    let low = 0;
    let high = fences.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (fences[mid] < end) low = mid + 1;
      else high = mid;
    }
    return low;
  };
}
export function placeFigures(text, items) {
  const fencesBefore = fenceCounter(text);
  const cuts = items
    .map((figure) => {
      const at = text.indexOf(figure.anchor);
      if (at < 0) return null;
      let end = at + figure.anchor.length;
      for (;;) {
        const next = text.indexOf("\n\n", end);
        if (next < 0) return { end: text.length, figure };
        end = next;
        if (fencesBefore(end) % 2 === 0) return { end, figure };
        end += 2;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.end - b.end);
  const segments = [];
  let from = 0;
  for (const { end, figure } of cuts) {
    if (end > from) segments.push({ text: text.slice(from, end) });
    segments.push({ figure });
    from = end;
  }
  if (from < text.length) segments.push({ text: text.slice(from) });
  return segments;
}
// 후보가 놓일 구간 제목(가장 가까운 앞 소제목) · 사람이 위치를 가늠하는 용도
export function anchorSection(text, anchor) {
  const at = text.indexOf(anchor);
  if (at < 0) return null;
  return (
    text
      .slice(0, at)
      .match(/^#{2,}\s+(.+)$/gm)
      ?.at(-1)
      ?.replace(/^#+\s+/, "") ?? null
  );
}
// 고른 자리가 있고 아직 확정되지 않은 단계 · 이 밖(제안 중·버림)에는 놓을 자리가 없다
const SELECTED_PHASES = new Set(["compose", "design", "generate", "review"]);
// 본문에 놓을 그림 자리 · 그림이 있으면 그림, 없으면 고른 자리와 그 상태(FIGURE_SPOTS) · FIGURE-001
// 위치 고르기는 모든 후보, 확정 전 단계는 고른 자리 전부, 확정 뒤는 남긴 그림만 · busy: 실제 AI 작업 진행 여부
/** @returns {Array<{ id: string, anchor: string, item?: object, spot?: string }>} */
export function figureSpots(figure, busy = false) {
  if (figure?.phase === "choose")
    return (figure.candidates ?? []).map((candidate) => ({ ...candidate, spot: "candidate" }));
  const items = figure?.items ?? [];
  if (figure?.phase === "confirmed") return items.map((item) => ({ ...item, item }));
  if (!SELECTED_PHASES.has(figure?.phase)) return [];
  const drawn = new Map(items.map((item) => [item.id, item]));
  const candidates = new Map(figure.candidates.map((candidate) => [candidate.id, candidate]));
  const working = new Set(figure.phase === "generate" ? currentOf(figure).ids : []);
  const spotOf = (id) => {
    if (figure.failed?.[id]) return "failed";
    if (figure.phase === "compose") return busy ? "composing" : "stopped";
    if (figure.phase === "design") return "design";
    if (!working.has(id)) return "queued";
    return busy ? "drawing" : "stopped";
  };
  return figure.selected.flatMap((id) => {
    const item = drawn.get(id);
    if (item) return [{ ...item, item }];
    const candidate = candidates.get(id);
    if (!candidate) return [];
    const spot = spotOf(id);
    return [{ ...candidate, spot, ...(spot === "failed" ? { error: figure.failed[id] } : {}) }];
  });
}
