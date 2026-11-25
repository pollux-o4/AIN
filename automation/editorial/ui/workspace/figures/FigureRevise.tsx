import { useMemo, useState } from "react";
import {
  FIGURE_LIMITS,
  FIGURE_REVISE_TARGETS,
  revisionReady,
} from "../../../../contracts/figure.mjs";
import type { Figure } from "../../shared/api";
import { LookSelect } from "./LookSelect";
import type { DecisionProps } from "./SkipFigures";
import { useLookChange } from "./useLookChange";

// 되돌릴 곳 · 무엇을 그릴지면 구성으로, 어떻게 그렸는지면 직전 그림에서 지적만 고친다 · ADR-0026
const TARGETS: Record<
  (typeof FIGURE_REVISE_TARGETS)[number],
  { key: string; label: string; quiet: boolean }
> = {
  compose: { key: "compose", label: "장면 다시 구성", quiet: false },
  fix: { key: "generate", label: "부분 고치기", quiet: true },
};

// 만든 그림 한 장을 의견이나 새 그림체와 함께 되돌린다 · 의견은 그 그림에만 머문다
// 그림체를 바꾸면 그 그림(과 고른 경우 같은 대상이 나오는 그림)만 다시 구성한다 · ADR-0027
export function FigureRevise({
  id,
  figure,
  disabled,
  onAction,
}: Pick<DecisionProps, "disabled" | "onAction"> & { id: string; figure: Figure }) {
  const [feedback, setFeedback] = useState("");
  const ids = useMemo(() => [id], [id]);
  const text = feedback.trim();
  // 만든 그림끼리만 함께 바꾼다 · 아직 없는 그림은 되돌릴 것이 없다
  const made = useMemo(() => {
    const ids = new Set(figure.items.map((item) => item.id));
    return figure.candidates.filter((c) => ids.has(c.id));
  }, [figure.candidates, figure.items]);
  const change = useLookChange(made, ids);
  const { look, targets: figures } = change;
  // 요청 검사와 같은 규칙(revisionReady) · 부분 고치기는 그림체를 유지한다
  const ready = (target: (typeof FIGURE_REVISE_TARGETS)[number]) =>
    revisionReady({ target, feedback: text, look });
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
      <LookSelect id={`revise-look-${id}`} change={change} />
      <div className="submit-row">
        {FIGURE_REVISE_TARGETS.map((target) => (
          <button
            key={target}
            type="button"
            id={`revise-${TARGETS[target].key}-${id}`}
            className={TARGETS[target].quiet ? "quiet" : undefined}
            disabled={disabled || !ready(target)}
            aria-describedby={target === "fix" && look ? `revise-fix-note-${id}` : undefined}
            onClick={() =>
              void onAction({
                type: "revise_figures",
                target,
                figures: target === "compose" ? figures : [id],
                ...(text ? { feedback: text } : {}),
                ...(target === "compose" && look ? { look } : {}),
              })
            }
          >
            {target === "compose" && look && !text
              ? figures.length > 1
                ? `${figures.length}개를 이 그림체로 다시 그리기`
                : "이 그림체로 다시 그리기"
              : TARGETS[target].label}
          </button>
        ))}
      </div>
      {look && (
        <p className="hint" id={`revise-fix-note-${id}`}>
          부분 고치기는 지금 그림을 다듬는 일이라 그림체를 그대로 둡니다.
        </p>
      )}
    </details>
  );
}
