import { useState } from "react";
import { type ActionCommand, type Figure, figureUrl, type Run } from "../shared/api";
import { Icon } from "../shared/Icon";

// 시각자료 선택 단계의 사람 결정 두 가지 · 본문은 바뀌지 않는다 · FIGURE-001
type Props = {
  run: Run;
  figure: Figure;
  disabled: boolean;
  onAction: (command: ActionCommand) => Promise<void>;
};
const quote = (text: string) => (text.length > 90 ? `${text.slice(0, 90)}…` : text);

function usePicked(ids: string[]) {
  const [picked, setPicked] = useState(ids);
  const toggle = (id: string) =>
    setPicked((old) => (old.includes(id) ? old.filter((item) => item !== id) : [...old, id]));
  // 보낼 때는 제안 순서대로
  return { picked: ids.filter((id) => picked.includes(id)), toggle };
}
function Skip({ disabled, onAction }: Pick<Props, "disabled" | "onAction">) {
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

// AI가 제안한 위치 후보 중 만들 곳을 고른다 · 생성은 AI 호출이라 고른 뒤에만
export function FigureChoice({ figure, disabled, onAction }: Props) {
  const { picked, toggle } = usePicked(figure.candidates.map((candidate) => candidate.id));
  return (
    <form
      id="figure-choice"
      onSubmit={(event) => {
        event.preventDefault();
        void onAction({ type: "select_figures", figures: picked });
      }}
    >
      <fieldset className="figure-list">
        <legend>
          시각자료를 만들 위치
          <span className="hint">
            고른 문장 뒤에 놓을 시각자료를 만듭니다(AI 호출). 본문은 바뀌지 않습니다.
          </span>
        </legend>
        {figure.note && <p id="figure-note">요청한 위치: {figure.note}</p>}
        {figure.coverage && (
          <p id="figure-coverage" className="hint">
            글 단위 {figure.coverage.units}곳 중 {figure.coverage.withFigure}곳에 후보{" "}
            {figure.coverage.candidates}개
            {figure.coverage.gap ? ` · 확인 필요: ${figure.coverage.gap}` : ""}
          </p>
        )}
        {figure.candidates.map((candidate) => (
          <label key={candidate.id} className="figure-option">
            <input
              type="checkbox"
              name="figures"
              value={candidate.id}
              checked={picked.includes(candidate.id)}
              onChange={() => toggle(candidate.id)}
            />
            <span>
              <strong>{candidate.claim}</strong>
              <q>{quote(candidate.anchor)}</q>
              <small>{candidate.section ? `‘${candidate.section}’ 구간 · ` : ""}이 문장 뒤</small>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="submit-row">
        <Skip disabled={disabled} onAction={onAction} />
        <button id="select-figures" type="submit" disabled={disabled || !picked.length}>
          <Icon name="image" />
          {picked.length ? `${picked.length}곳에 만들기` : "위치를 골라 주세요"}
        </button>
      </div>
    </form>
  );
}

// 만든 시각자료를 본문 속 자리와 함께 확인 · 확인한 것만 넘길 결과물에 들어간다
export function FigureReview({
  run,
  figure,
  disabled,
  onAction,
  onLocate,
}: Props & { onLocate: (id: string) => void }) {
  const { picked, toggle } = usePicked(figure.items.map((item) => item.id));
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
                <img src={figureUrl(run, item.id)} alt={item.alt} />
                <strong id={`keep-${item.id}-name`}>{item.caption ?? item.claim}</strong>
              </label>
              <q>{quote(item.anchor)}</q>
              <button type="button" className="quiet" onClick={() => onLocate(item.id)}>
                본문에서 보기
              </button>
            </span>
          </div>
        ))}
      </fieldset>
      <div className="submit-row">
        <Skip disabled={disabled} onAction={onAction} />
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
