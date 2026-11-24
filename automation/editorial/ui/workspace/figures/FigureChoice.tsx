import { Icon } from "../../shared/Icon";
import { ROUTE_NAMES } from "./plan";
import { type DecisionProps, SkipFigures } from "./SkipFigures";
import type { FigureChoiceState } from "./usePicked";

// AI가 제안한 위치 후보 중 만들 곳을 고른다 · 고르기는 본문 자리와 이 목록이 같은 상태를 쓴다
// 생성은 AI 호출이라 고른 뒤에만
export function FigureChoice({
  figure,
  choice,
  disabled,
  onAction,
  onLocate,
}: Omit<DecisionProps, "run"> & { choice: FigureChoiceState; onLocate: (id: string) => void }) {
  const { picked, toggle } = choice;
  const first = choice.candidates[0]?.id;
  return (
    <form
      id="figure-choice"
      onSubmit={(event) => {
        event.preventDefault();
        const directions = choice.directions();
        const routes = choice.routes();
        void onAction({
          type: "select_figures",
          figures: picked,
          ...(Object.keys(directions).length ? { directions } : {}),
          ...(Object.keys(routes).length ? { routes } : {}),
        });
      }}
    >
      {first && (
        <button type="button" className="quiet figure-locate" onClick={() => onLocate(first)}>
          <Icon name="eye" />
          본문에서 고르기
        </button>
      )}
      <fieldset className="figure-list">
        <legend>
          시각자료를 만들 위치
          <span className="hint">
            본문에 표시한 후보 자리에서 바로 고를 수 있습니다. 고른 문장 뒤에 놓을 시각자료를
            만들며(AI 호출) 본문은 바뀌지 않습니다.
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
        {figure.style && (
          <p id="figure-style" className="hint">
            모든 그림이 함께 지킬 규칙 · {figure.style.look ? `스타일 ${figure.style.look} · ` : ""}
            강조 {figure.style.accent} · 기본 {figure.style.base} · 라벨 {figure.style.labels}
          </p>
        )}
        {choice.candidates.map((candidate) => (
          <div key={candidate.id} className="figure-option">
            <input
              id={`pick-${candidate.id}`}
              type="checkbox"
              name="figures"
              value={candidate.id}
              checked={picked.includes(candidate.id)}
              onChange={() => toggle(candidate.id)}
            />
            <span>
              <label htmlFor={`pick-${candidate.id}`}>
                <small>후보 {choice.numberOf(candidate.id)}</small>
                <strong>{candidate.claim}</strong>
              </label>
              <small>
                {candidate.section ? `‘${candidate.section}’ 구간` : "도입부"}
                {picked.includes(candidate.id)
                  ? ` · ${ROUTE_NAMES[choice.routeOf(candidate.id)]}`
                  : ""}
                {picked.includes(candidate.id) && choice.directionOf(candidate.id).trim()
                  ? " · 방향 있음"
                  : ""}
              </small>
              <button type="button" className="quiet" onClick={() => onLocate(candidate.id)}>
                본문에서 보기
              </button>
            </span>
          </div>
        ))}
      </fieldset>
      <div className="submit-row">
        <SkipFigures disabled={disabled} onAction={onAction} />
        <button id="select-figures" type="submit" disabled={disabled || !picked.length}>
          <Icon name="image" />
          {picked.length ? `${picked.length}곳에 만들기` : "위치를 골라 주세요"}
        </button>
      </div>
    </form>
  );
}
