import { coverageGap, currentOf } from "../domain/figures.mjs";
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
    // 위치 제안이 세운 그림 계획(무엇을·왜·어떤 구도로) · 사람이 고르기 전에 만들 그림을 가늠하고 보완하게
    candidates: (figure.candidates ?? []).map(
      ({ id, anchor, claim, reason, analogy, scene, kind, motifs }) => ({
        id,
        anchor,
        claim,
        reason: reason ?? null,
        analogy: analogy ?? null,
        scene: scene ?? null,
        kind: kind ?? null,
        motifs: motifs ?? [],
        section: anchorSection(text, anchor),
      }),
    ),
    // 그림 사이 일관성 계약 · ADR-0022
    style: figure.style ?? null,
    motifs: figure.motifs ?? [],
    selected: figure.selected ?? [],
    // 위치 제안이 글의 단위를 얼마나 훑었는지(세기) · 부족하면 gap 문장
    coverage: figure.coverage ? { ...figure.coverage, gap: coverageGap(figure.coverage) } : null,
    // 생성 중인 그림 한 장과 층 · 마친 그림 수는 items
    current: figure.phase === "generate" ? currentOf(figure) : null,
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
