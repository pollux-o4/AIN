import { useState } from "react";
import type { FigureRoute } from "../../shared/api";
import type { Candidate } from "./plan";

export type Routes = {
  routeOf: (id: string) => FigureRoute;
  setRoute: (id: string, route: FigureRoute) => void;
  // 보낼 경로 · 고른 후보 중 서버 실효 경로와 다르게 바꾼 것만(ADR-0025)
  routes: () => Record<string, FigureRoute>;
};

// 후보별 경로 선택 · 기본값은 서버가 정한 실효 경로이고, 위치 제안이 바뀌면(key) 초기화한다
export function useRoutes(key: string, candidates: Candidate[], picked: string[]): Routes {
  const [state, setState] = useState<{ key: string; map: Record<string, FigureRoute> }>({
    key,
    map: {},
  });
  const map = state.key === key ? state.map : {};
  const serverRoute = (id: string) =>
    candidates.find((candidate) => candidate.id === id)?.route ?? "svg";
  const routeOf = (id: string) => map[id] ?? serverRoute(id);
  return {
    routeOf,
    setRoute: (id, route) => setState({ key, map: { ...map, [id]: route } }),
    routes: () =>
      Object.fromEntries(
        picked.flatMap((id) => (routeOf(id) !== serverRoute(id) ? [[id, routeOf(id)]] : [])),
      ),
  };
}
