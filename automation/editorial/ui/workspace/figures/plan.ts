import { FIGURE_KINDS } from "../../../../contracts/figure.mjs";
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
