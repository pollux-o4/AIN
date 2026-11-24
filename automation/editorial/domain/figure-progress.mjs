// 그림 생성 진행 상태 · 지금 그리는 묶음과 아직 그림이 없는 고른 자리 · 상태 전이·본문 배치·실행 표시가 함께 읽는다 · ADR-0026
import { FIGURE_PASSES } from "../../contracts/figure.mjs";

// 아직 그림이 없는 고른 자리 · 되돌린 그림은 items에서 빠져 다시 만든다
export const pendingIds = (figure, items = figure.items ?? []) => {
  const done = new Set(items.map((item) => item.id));
  return (figure.selected ?? []).filter((id) => !done.has(id));
};
// 지금 생성 중인 묶음: 같은 층을 밟는 그림들 · 그림마다 따로 그리되 동시에 돌린다 · ADR-0026
// 묶음 도입 전 상태(current.id·draft 한 장)도 같은 모양으로 읽는다
export function currentOf(figure) {
  const current = figure.current;
  if (current) return { ids: current.ids ?? [current.id], pass: current.pass };
  return { ids: pendingIds(figure), pass: FIGURE_PASSES[0] };
}
export const passOf = (figure) => currentOf(figure).pass;
