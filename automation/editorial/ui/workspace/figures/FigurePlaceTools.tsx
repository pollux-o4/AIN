import type { ActionCommand } from "../../shared/api";
import type { Candidate } from "./plan";
import type { FigureChoiceState } from "./usePicked";

// 후보 카드의 범위 도구 · 범위 조절(모든 후보)·추가 취소(직접 추가한 후보만) · 본문 카드와 도크 목록이 같이 쓴다(ADR-0030)
export function FigurePlaceTools({
  candidate,
  choice,
  disabled,
  onAction,
}: {
  candidate: Candidate;
  choice: FigureChoiceState;
  disabled: boolean;
  onAction: (command: ActionCommand) => Promise<void>;
}) {
  const human = candidate.origin === "human";
  const on = choice.adjusting === candidate.id;
  return (
    <span className="figure-place-tools">
      {human && <span className="figure-origin">직접 추가</span>}
      <button
        type="button"
        className="quiet"
        disabled={disabled}
        aria-pressed={on}
        onClick={() => choice.adjust(on ? null : candidate.id)}
      >
        {on ? "범위 조절 중" : "범위 조절"}
      </button>
      {human && (
        <button
          type="button"
          className="quiet"
          disabled={disabled}
          onClick={() => void onAction({ type: "remove_figure", figure: candidate.id })}
        >
          추가 취소
        </button>
      )}
    </span>
  );
}
