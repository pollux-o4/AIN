import { useMemo } from "react";
import { FIGURE_LIMITS, revisionReady } from "../../../../contracts/figure.mjs";
import type { Figure } from "../../shared/api";
import { LookSelect } from "./LookSelect";
import type { DecisionProps } from "./SkipFigures";
import { useLookChange } from "./useLookChange";

// 만든 그림 한 장에 남길 의견 · 의견은 그 그림에만 머문다 · ADR-0026
// 무엇을 그릴지면 여기서 바로 다시 구성, 어떻게 그렸는지면 의견만 적어 두고 아래에서 모아 부분 고치기
// 그림체를 바꾸면 그 그림(과 고른 경우 같은 대상이 나오는 그림)만 다시 구성한다 · ADR-0027
export function FigureRevise({
  id,
  figure,
  note,
  onNote,
  disabled,
  onAction,
}: Pick<DecisionProps, "disabled" | "onAction"> & {
  id: string;
  figure: Figure;
  note: string;
  onNote: (text: string) => void;
}) {
  const ids = useMemo(() => [id], [id]);
  const text = note.trim();
  // 만든 그림끼리만 함께 바꾼다 · 아직 없는 그림은 바꿀 것이 없다
  const made = useMemo(() => {
    const ids = new Set(figure.items.map((item) => item.id));
    return figure.candidates.filter((c) => ids.has(c.id));
  }, [figure.candidates, figure.items]);
  const change = useLookChange(made, ids);
  const { look, targets: figures } = change;
  const request = {
    type: "revise_figures" as const,
    target: "compose" as const,
    figures,
    ...(text ? { feedback: text } : {}),
    ...(look ? { look } : {}),
  };
  return (
    <details className="figure-revise" open={Boolean(text) || undefined}>
      <summary>이 그림 고치기</summary>
      <label htmlFor={`revise-${id}`}>고칠 의견</label>
      <textarea
        id={`revise-${id}`}
        rows={3}
        maxLength={FIGURE_LIMITS.feedback}
        value={note}
        onChange={(event) => onNote(event.target.value)}
      />
      <p className="hint">
        어떻게 그렸는지의 지적은 적어 두면 아래 ‘부분 고치기’로 다른 그림과 함께 고칩니다. 그림체는
        그대로 둡니다.
      </p>
      <LookSelect id={`revise-look-${id}`} change={change} />
      <div className="submit-row">
        <button
          type="button"
          id={`revise-compose-${id}`}
          disabled={disabled || !revisionReady(request)}
          onClick={() => void onAction(request)}
        >
          {look && !text
            ? figures.length > 1
              ? `${figures.length}개를 이 그림체로 다시 그리기`
              : "이 그림체로 다시 그리기"
            : "장면 다시 구성"}
        </button>
      </div>
    </details>
  );
}
