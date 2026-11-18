import { useState } from "react";
import type { FigureRoute, Run } from "../../shared/api";
import { savedFigureDirections, storeFigureDirections } from "../../shared/persistence";
import { type Candidate, candidateNumber, type Motif } from "./plan";
import { type Routes, useRoutes } from "./useRoutes";

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

type Directions = {
  directionOf: (id: string) => string;
  setDirection: (id: string, text: string) => void;
  // 보낼 방향 · 고른 후보 중 쓴 것만
  directions: () => Record<string, string>;
};
// 후보별 그림 방향 초안 · 새로고침해도 같은 위치 제안이면 되살린다 · ADR-0023
function useDirections(key: string, picked: string[]): Directions {
  const [state, setState] = useState(() => ({ key, map: savedFigureDirections(key) }));
  const map = state.key === key ? state.map : savedFigureDirections(key);
  return {
    directionOf: (id) => map[id] ?? "",
    setDirection: (id, text) => {
      const next = { ...map, [id]: text };
      setState({ key, map: next });
      storeFigureDirections(key, next);
    },
    directions: () =>
      Object.fromEntries(picked.flatMap((id) => (map[id]?.trim() ? [[id, map[id].trim()]] : []))),
  };
}

export type FigureChoiceState = Picks &
  Directions &
  Routes & {
    candidates: Candidate[];
    routesAvailable: FigureRoute[];
    motifs: Motif[];
    numberOf: (id: string) => number;
  };
// 위치 선택의 단일 상태(고르기·방향·경로) · 본문 자리와 도크 목록이 함께 쓴다(FIGURE-001)
export function useFigureChoice(run: Run | null): FigureChoiceState | null {
  const candidates = (run?.canSelectFigures && run.figure?.candidates) || [];
  const ids = candidates.map((candidate) => candidate.id);
  const key = run ? `${run.id}:${run.version}` : "";
  const picks = usePicked(ids, key);
  const directions = useDirections(key, picks.picked);
  const routes = useRoutes(key, candidates, picks.picked);
  if (!candidates.length) return null;
  return {
    ...picks,
    ...directions,
    ...routes,
    routesAvailable: run?.figure?.routesAvailable ?? ["svg"],
    candidates,
    motifs: run?.figure?.motifs ?? [],
    numberOf: (id) => candidateNumber(candidates, id),
  };
}
