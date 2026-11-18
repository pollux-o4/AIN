import { useState } from "react";
import type { Run } from "../../shared/api";
import { type Candidate, candidateNumber, type Motif } from "./plan";

export type Picks = { picked: string[]; toggle: (id: string) => void };

// 고른 항목 · 처음엔 모두 고른 상태 · resetKey가 바뀌면(새 제안) 다시 모두 고른 상태로
export function usePicked(ids: string[], resetKey = ""): Picks {
  const [state, setState] = useState({ key: resetKey, picked: ids });
  const current = state.key === resetKey ? state.picked : ids;
  const toggle = (id: string) =>
    setState({
      key: resetKey,
      picked: current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    });
  // 보낼 때는 제안 순서대로
  return { picked: ids.filter((id) => current.includes(id)), toggle };
}

export type FigureChoiceState = Picks & {
  candidates: Candidate[];
  motifs: Motif[];
  numberOf: (id: string) => number;
};
// 위치 선택의 단일 상태 · 본문 자리와 도크 목록이 함께 쓴다(FIGURE-001)
export function useFigureChoice(run: Run | null): FigureChoiceState | null {
  const candidates = (run?.canSelectFigures && run.figure?.candidates) || [];
  const ids = candidates.map((candidate) => candidate.id);
  const picks = usePicked(ids, run ? `${run.id}:${run.version}` : "");
  if (!candidates.length) return null;
  return {
    ...picks,
    candidates,
    motifs: run?.figure?.motifs ?? [],
    numberOf: (id) => candidateNumber(candidates, id),
  };
}
