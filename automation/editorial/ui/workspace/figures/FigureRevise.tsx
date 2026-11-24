import { useState } from "react";
import { FIGURE_LIMITS, FIGURE_REVISE_TARGETS } from "../../../../contracts/figure.mjs";
import type { DecisionProps } from "./SkipFigures";

// 되돌릴 곳 · 무엇을 그릴지면 구성으로, 어떻게 그렸는지면 직전 그림에서 지적만 고친다 · ADR-0026
const TARGETS: Record<
  (typeof FIGURE_REVISE_TARGETS)[number],
  { key: string; label: string; quiet: boolean }
> = {
  compose: { key: "compose", label: "장면 다시 구성", quiet: false },
  fix: { key: "generate", label: "부분 고치기", quiet: true },
};

// 만든 그림 한 장을 의견과 함께 되돌린다 · 의견은 그 그림에만 머문다
export function FigureRevise({
  id,
  disabled,
  onAction,
}: Pick<DecisionProps, "disabled" | "onAction"> & { id: string }) {
  const [feedback, setFeedback] = useState("");
  const text = feedback.trim();
  return (
    <details className="figure-revise">
      <summary>되돌리기</summary>
      <label htmlFor={`revise-${id}`}>고칠 의견</label>
      <textarea
        id={`revise-${id}`}
        rows={3}
        maxLength={FIGURE_LIMITS.feedback}
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
      />
      <div className="submit-row">
        {FIGURE_REVISE_TARGETS.map((target) => (
          <button
            key={target}
            type="button"
            id={`revise-${TARGETS[target].key}-${id}`}
            className={TARGETS[target].quiet ? "quiet" : undefined}
            disabled={disabled || !text}
            onClick={() =>
              void onAction({ type: "revise_figures", feedback: text, figures: [id], target })
            }
          >
            {TARGETS[target].label}
          </button>
        ))}
      </div>
    </details>
  );
}
