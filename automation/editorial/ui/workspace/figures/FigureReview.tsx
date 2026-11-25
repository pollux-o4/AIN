import { Icon } from "../../shared/Icon";
import { FigureImage } from "./FigureImage";
import { FigureOption } from "./FigureOption";
import { FigureRetry } from "./FigureRetry";
import { FigureRevise } from "./FigureRevise";
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
  const picks = usePicked(figure.items.map((item) => item.id));
  const { picked } = picks;
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
          <FigureOption
            key={item.id}
            scope="keep"
            id={item.id}
            picks={picks}
            labelledBy={`keep-${item.id}-name`}
            label={
              <>
                <FigureImage run={run} item={item} />
                <strong id={`keep-${item.id}-name`}>{item.caption ?? item.claim}</strong>
              </>
            }
          >
            <AnchorQuote text={quote(item.anchor)} id={item.id} onLocate={onLocate} />
            {run.canReviseFigures && (
              <FigureRevise id={item.id} figure={figure} disabled={disabled} onAction={onAction} />
            )}
          </FigureOption>
        ))}
      </fieldset>
      <FigureRetry figure={figure} disabled={disabled} onAction={onAction} onLocate={onLocate} />
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
