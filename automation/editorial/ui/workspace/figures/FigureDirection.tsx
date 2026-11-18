import { FIGURE_LIMITS } from "../../../../contracts/figure.mjs";
import type { FigureChoiceState } from "./usePicked";

// 고른 후보 아래 접힌 방향 입력 · 쓰지 않으면 계획대로 · 쓴 방향은 위치 제안의 구도보다 먼저 따른다(ADR-0023)
export function FigureDirection({ id, choice }: { id: string; choice: FigureChoiceState }) {
  const value = choice.directionOf(id);
  const has = Boolean(value.trim());
  return (
    <details className="figure-direction">
      <summary>
        방향 덧붙이기
        {has && <span className="figure-direction-mark"> · 방향 있음</span>}
      </summary>
      <textarea
        aria-label={`후보 ${choice.numberOf(id)} 그림 방향`}
        rows={2}
        maxLength={FIGURE_LIMITS.direction}
        placeholder="예: 두 상태를 좌우로 나란히 비교하는 구도로"
        value={value}
        onChange={(event) => choice.setDirection(id, event.target.value)}
      />
    </details>
  );
}
