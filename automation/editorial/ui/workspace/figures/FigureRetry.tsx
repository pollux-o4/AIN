import { Icon } from "../../shared/Icon";
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
  const { picked, toggle } = usePicked(failed, failed.join());
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
          <div key={id} className="figure-option">
            <input
              id={`retry-${id}`}
              type="checkbox"
              checked={picked.includes(id)}
              onChange={() => toggle(id)}
            />
            <span>
              <label htmlFor={`retry-${id}`}>
                <strong>{candidate?.claim ?? id}</strong>
              </label>
              <small>
                {placeName(candidate?.section ?? null)} · 사유: {figure.failed[id]}
              </small>
              <LocateButton id={id} onLocate={onLocate} />
            </span>
          </div>
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
