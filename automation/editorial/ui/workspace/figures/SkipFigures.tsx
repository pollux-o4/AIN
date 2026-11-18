import type { ActionCommand, Figure, Run } from "../../shared/api";

// 시각자료 선택 단계의 사람 결정 두 가지(위치 선택·만든 그림 확인)가 함께 쓰는 입력 · 본문은 바뀌지 않는다 · FIGURE-001
export type DecisionProps = {
  run: Run;
  figure: Figure;
  disabled: boolean;
  onAction: (command: ActionCommand) => Promise<void>;
};

export function SkipFigures({ disabled, onAction }: Pick<DecisionProps, "disabled" | "onAction">) {
  return (
    <button
      type="button"
      className="quiet"
      disabled={disabled}
      onClick={() => void onAction({ type: "discard_figures" })}
    >
      시각자료 없이 진행
    </button>
  );
}
