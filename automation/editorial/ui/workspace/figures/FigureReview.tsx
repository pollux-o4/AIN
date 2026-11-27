import { useMemo } from "react";
import { Icon } from "../../shared/Icon";
import { FigureFixes } from "./FigureFixes";
import { FigureImage } from "./FigureImage";
import { FigureOption } from "./FigureOption";
import { FigureRetry } from "./FigureRetry";
import { FigureRevise } from "./FigureRevise";
import { AnchorQuote } from "./Locate";
import { type DecisionProps, SkipFigures } from "./SkipFigures";
import { useFixNotes } from "./useFixNotes";
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
  const ids = useMemo(() => figure.items.map((item) => item.id), [figure.items]);
  const picks = usePicked(ids);
  const { picked } = picks;
  const notes = useFixNotes(ids);
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
            본문에 ‘확인 전’으로 놓인 그림입니다. 체크를 풀면 그 그림만 빼고 넘기며, 본문 글은
            바뀌지 않습니다.
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
              <FigureRevise
                id={item.id}
                figure={figure}
                note={notes.note(item.id)}
                onNote={(text) => notes.setNote(item.id, text)}
                disabled={disabled}
                onAction={onAction}
              />
            )}
          </FigureOption>
        ))}
      </fieldset>
      <FigureRetry figure={figure} disabled={disabled} onAction={onAction} onLocate={onLocate} />
      <div className="submit-row">
        <SkipFigures disabled={disabled} onAction={onAction} />
        {run.canReviseFigures && (
          <FigureFixes notes={notes} disabled={disabled} onAction={onAction} />
        )}
        <button id="confirm-figures" type="submit" disabled={disabled || !picked.length}>
          <Icon name="check" />
          {picked.length === figure.items.length
            ? `시각자료 ${picked.length}개 모두 확인`
            : picked.length
              ? `${picked.length}개만 확인`
              : "넣을 것을 골라 주세요"}
        </button>
      </div>
    </form>
  );
}
