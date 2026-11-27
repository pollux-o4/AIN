import { Icon } from "../../shared/Icon";
import type { DecisionProps } from "./SkipFigures";
import type { FixNotes } from "./useFixNotes";

// 의견을 적은 그림을 한 번에 부분 고치기 · 그림마다 자기 의견만 받아 동시에 고친다(AI 호출 1회) · ADR-0026
export function FigureFixes({
  notes,
  disabled,
  onAction,
}: Pick<DecisionProps, "disabled" | "onAction"> & { notes: FixNotes }) {
  const { fix } = notes;
  return (
    <button
      id="revise-generate"
      type="button"
      className="quiet"
      disabled={disabled || !fix}
      title={fix ? undefined : "그림의 ‘이 그림 고치기’에 의견을 적으면 모아서 고칩니다."}
      onClick={() => fix && void onAction({ type: "revise_figures", ...fix })}
    >
      <Icon name="image" />
      {fix ? `${fix.figures.length}장 부분 고치기` : "부분 고치기"}
    </button>
  );
}
