import { anchorSection, placedFigures } from "../domain/index.mjs";
import { fail } from "./lifecycle.mjs";

const draftText = (state) => state.artifacts?.draft?.output?.text ?? "";

// 화면·에이전트용 시각자료 상태 · SVG 원문은 파일 조회로만 제공
export function figureView(state) {
  const figure = state.figure;
  if (!figure) return null;
  const text = draftText(state);
  return {
    phase: figure.phase,
    note: figure.note ?? null,
    candidates: (figure.candidates ?? []).map(({ id, anchor, claim }) => ({
      id,
      anchor,
      claim,
      section: anchorSection(text, anchor),
    })),
    selected: figure.selected ?? [],
    items: (figure.items ?? []).map(({ id, anchor, claim, alt, caption }) => ({
      id,
      anchor,
      claim,
      alt,
      caption: caption ?? null,
    })),
  };
}
// 준비됐거나 확인된 시각자료 파일 하나 · 버려진·이전 회차 것은 제공하지 않음
// shortcut: 인계는 TXT와 SVG 파일 개별 제공, 소비 제품의 묶음 인계(본문+배치 위치) 계약이 정해지면 매니페스트 추가
export function figureFile(run, figureId) {
  const item = placedFigures(run.state).find((figure) => figure.id === figureId);
  if (!item) fail("시각자료를 찾을 수 없습니다.", 404);
  return { svg: item.svg, filename: `figure-${run.id}-r${run.state.revision}-${item.id}.svg` };
}
