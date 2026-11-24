import { Icon } from "../../shared/Icon";
import { FigureOption } from "./FigureOption";
import { LocateButton } from "./Locate";
import { placeName } from "./plan";
import type { DecisionProps } from "./SkipFigures";
import { usePicked } from "./usePicked";

// 실패한 그림: 사유를 보이고 고른 것만 다시 그린다 · 끝난 그림은 그대로 둔다 · ADR-0026
export function FigureRetry({
  figure,
  disabled,
  onAction,
  onLocate,
}: Omit<DecisionProps, "run"> & { onLocate: (id: string) => void }) {
  const failed = figure.selected.filter((id) => figure.failed[id]);
  const picks = usePicked(failed, failed.join());
  const { picked } = picks;
  if (!failed.length) return null;
  const byId = new Map(figure.candidates.map((candidate) => [candidate.id, candidate]));
  return (
    <fieldset id="figure-retry" className="figure-list">
      <legend>
        그리지 못한 시각자료 {failed.length}곳
        <span className="hint">
          확인하면 이 자리는 넘길 결과물에서 빠집니다. 다시 그리면 고른 자리만 새로 그립니다(AI
          호출).
        </span>
      </legend>
      {failed.map((id) => {
        const candidate = byId.get(id);
        return (
          <FigureOption
            key={id}
            scope="retry"
            id={id}
            picks={picks}
            label={<strong>{candidate?.claim ?? id}</strong>}
          >
            <small>
              {placeName(candidate?.section ?? null)} · 사유: {figure.failed[id]}
            </small>
            <LocateButton id={id} onLocate={onLocate} />
          </FigureOption>
        );
      })}
      <div className="submit-row">
        <button
          id="retry-figures"
          type="button"
          disabled={disabled || !picked.length}
          onClick={() => void onAction({ type: "retry_figures", figures: picked })}
        >
          <Icon name="image" />
          {picked.length ? `${picked.length}곳 다시 그리기` : "다시 그릴 곳을 골라 주세요"}
        </button>
      </div>
    </fieldset>
  );
}
