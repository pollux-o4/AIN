import { FIGURE_KINDS, FIGURE_LOOKS } from "../../../../contracts/figure.mjs";
import type { FigureRoute, Run } from "../../shared/api";

// 시각자료 후보 모델 · 본문 자리·도크 목록·계획이 같은 번호와 유형 이름을 쓴다
type Figure = NonNullable<Run["figure"]>;
export type Candidate = Figure["candidates"][number];
export type Motif = Figure["motifs"][number];

export const kindName = (kind: string | null) =>
  (kind && FIGURE_KINDS[kind as keyof typeof FIGURE_KINDS]?.name) || null;
// 후보 번호 · 제안 순서 기준
export const candidateNumber = (candidates: Candidate[], id: string) =>
  candidates.findIndex((item) => item.id === id) + 1;
// 경로 표시 이름 · 경로 선택·도크 목록·검토가 같은 이름을 쓴다(ADR-0025)
export const ROUTE_NAMES: Record<FigureRoute, string> = { svg: "도식(SVG)", image: "그림(이미지)" };
// 자리 이름 · 도크 목록·구성 확인·본문 자리가 같은 이름을 쓴다
export const placeName = (section: string | null) => (section ? `‘${section}’ 구간` : "도입부");
// 반복 대상 이름 → 모양 · 후보마다 다시 훑지 않게 한 번 색인
export const motifIndex = (motifs: Motif[]) => new Map(motifs.map((motif) => [motif.name, motif]));
export type LookId = keyof typeof FIGURE_LOOKS;
// 그림체 이름 · 고르기·구성 확인·되돌리기가 같은 이름을 쓴다(ADR-0027)
export const lookName = (look: string | null) =>
  (look && FIGURE_LOOKS[look as LookId]?.label) || null;
// 같은 반복 대상이 나오는 다른 자리와 그 대상 이름 · 그림체를 바꿀 때 함께 바꿀 후보(ADR-0022·0027)
export function motifPeers(candidates: Candidate[], id: string) {
  const own = new Set(candidates.find((item) => item.id === id)?.motifs ?? []);
  const names = new Set<string>();
  const ids = candidates.flatMap((item) => {
    if (item.id === id) return [];
    const shared = item.motifs.filter((name) => own.has(name));
    for (const name of shared) names.add(name);
    return shared.length ? [item.id] : [];
  });
  return { ids, names: [...names] };
}
