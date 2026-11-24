import { useState } from "react";
import { FIGURE_LIMITS, FIGURE_REVISE_TARGETS } from "../../../../contracts/figure.mjs";
import { Icon } from "../../shared/Icon";
import { FigureImage } from "./FigureImage";
import { AnchorQuote } from "./Locate";
import { type DecisionProps, SkipFigures } from "./SkipFigures";
import { usePicked } from "./usePicked";

const quote = (text: string) => (text.length > 90 ? `${text.slice(0, 90)}…` : text);

// 만든 시각자료를 본문 속 자리와 함께 확인 · 확인한 것만 넘길 결과물에 들어간다
export function FigureReview({
  run,
  figure,
  disabled,
  onAction,
  onLocate,
}: DecisionProps & { onLocate: (id: string) => void }) {
  const { picked, toggle } = usePicked(figure.items.map((item) => item.id));
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  return (
    <form
      id="figure-review"
      onSubmit={(event) => {
        event.preventDefault();
        void onAction({ type: "confirm_figures", figures: picked });
      }}
    >
      <fieldset className="figure-list">
        <legend>
          넘길 결과물에 넣을 시각자료
          <span className="hint">
            본문에는 ‘확인 전’으로 놓여 있습니다. 확인한 것만 포함되고 본문은 바뀌지 않습니다.
          </span>
        </legend>
        {figure.items.map((item) => (
          <div key={item.id} className="figure-option">
            <input
              id={`keep-${item.id}`}
              type="checkbox"
              name="figures"
              value={item.id}
              checked={picked.includes(item.id)}
              onChange={() => toggle(item.id)}
              aria-labelledby={`keep-${item.id}-name`}
            />
            <span>
              <label htmlFor={`keep-${item.id}`}>
                <FigureImage run={run} item={item} />
                <strong id={`keep-${item.id}-name`}>{item.caption ?? item.claim}</strong>
              </label>
              <AnchorQuote text={quote(item.anchor)} id={item.id} onLocate={onLocate} />
              {run.canReviseFigures && (
                <details className="figure-revise">
                  <summary>되돌리기</summary>
                  <label htmlFor={`revise-${item.id}`}>고칠 의견</label>
                  <textarea
                    id={`revise-${item.id}`}
                    rows={3}
                    maxLength={FIGURE_LIMITS.feedback}
                    value={feedback[item.id] ?? ""}
                    onChange={(event) =>
                      setFeedback((current) => ({ ...current, [item.id]: event.target.value }))
                    }
                  />
                  <div className="submit-row">
                    <button
                      type="button"
                      id={`revise-compose-${item.id}`}
                      disabled={disabled || !feedback[item.id]?.trim()}
                      onClick={() =>
                        void onAction({
                          type: "revise_figures",
                          feedback: feedback[item.id].trim(),
                          figures: [item.id],
                          target: FIGURE_REVISE_TARGETS[0],
                        })
                      }
                    >
                      장면 다시 구성
                    </button>
                    <button
                      type="button"
                      id={`revise-generate-${item.id}`}
                      className="quiet"
                      disabled={disabled || !feedback[item.id]?.trim()}
                      onClick={() =>
                        void onAction({
                          type: "revise_figures",
                          feedback: feedback[item.id].trim(),
                          figures: [item.id],
                          target: FIGURE_REVISE_TARGETS[1],
                        })
                      }
                    >
                      부분 고치기
                    </button>
                  </div>
                </details>
              )}
            </span>
          </div>
        ))}
      </fieldset>
      <div className="submit-row">
        <SkipFigures disabled={disabled} onAction={onAction} />
        <button id="confirm-figures" type="submit" disabled={disabled || !picked.length}>
          <Icon name="check" />
          {picked.length === figure.items.length
            ? "시각자료 확인"
            : picked.length
              ? `${picked.length}개만 확인`
              : "넣을 것을 골라 주세요"}
        </button>
      </div>
    </form>
  );
}
