import { FIGURE_KINDS } from "../../../../contracts/figure.mjs";
import type { Run } from "../../shared/api";

// 시각자료 후보 모델 · 본문 자리·도크 목록·계획이 같은 번호와 유형 이름을 쓴다
type Figure = NonNullable<Run["figure"]>;
export type Candidate = Figure["candidates"][number];
export type Motif = Figure["motifs"][number];

export const kindName = (kind: string | null) =>
  (kind && FIGURE_KINDS[kind as keyof typeof FIGURE_KINDS]?.name) || null;
// 후보 번호 · 제안 순서 기준
export const candidateNumber = (candidates: Candidate[], id: string) =>
  candidates.findIndex((item) => item.id === id) + 1;
