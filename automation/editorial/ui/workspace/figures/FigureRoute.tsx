import { FIGURE_ROUTES } from "../../../../contracts/figure.mjs";
import { ROUTE_NAMES } from "./plan";
import type { FigureChoiceState } from "./usePicked";

// 고른 후보의 경로 선택 · 기본은 유형별 경로 · 서버에 연결되지 않은 경로는 고를 수 없다(ADR-0025)
export function FigureRoute({ id, choice }: { id: string; choice: FigureChoiceState }) {
  const current = choice.routeOf(id);
  return (
    <fieldset className="figure-route">
      <legend>후보 {choice.numberOf(id)} 만드는 방식</legend>
      {FIGURE_ROUTES.map((route) => {
        const ready = choice.routesAvailable.includes(route);
        return (
          <label key={route} className={ready ? "" : "is-off"}>
            <input
              type="radio"
              name={`route-${id}`}
              value={route}
              checked={current === route}
              disabled={!ready}
              onChange={() => choice.setRoute(id, route)}
            />
            {ROUTE_NAMES[route]}
            {!ready && <small> · 아직 연결되지 않음</small>}
          </label>
        );
      })}
    </fieldset>
  );
}
