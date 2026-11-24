import { FIGURE_SPOTS } from "../../../../contracts/figure.mjs";
import { Icon } from "../../shared/Icon";
import { FigureDirection } from "./FigureDirection";
import { FigurePlan } from "./FigurePlan";
import { FigureRoute } from "./FigureRoute";
import { type Candidate, kindName, type Motif } from "./plan";
import type { FigureChoiceState } from "./usePicked";

// 자리 머리글 · 번호·유형·상태를 같은 순서로
function slotLabel(number: number, candidate: Candidate, state: string) {
  const kind = kindName(candidate.kind);
  return `시각자료 ${number}${kind ? ` · ${kind}` : ""} · ${state}`;
}

// 위치 고르기: 본문 자리에서 바로 고르고 경로·방향을 덧붙인다(FIGURE-001)
export function ChoiceSlot({
  candidate,
  choice,
}: {
  candidate: Candidate;
  choice: FigureChoiceState;
}) {
  const { id } = candidate;
  const on = choice.picked.includes(id);
  return (
    <div className="figure-slot-card">
      <button
        type="button"
        className="figure-slot-toggle"
        aria-pressed={on}
        onClick={() => choice.toggle(id)}
      >
        <span className="figure-slot-mark" aria-hidden="true">
          {on ? <Icon name="check" /> : null}
        </span>
        <span className="figure-slot-text">
          <small>{slotLabel(choice.numberOf(id), candidate, on ? "만들 곳" : "제외")}</small>
          <FigurePlan candidate={candidate} candidates={choice.candidates} motifs={choice.motifs} />
        </span>
      </button>
      {on && <FigureRoute id={id} choice={choice} />}
      {on && <FigureDirection id={id} choice={choice} />}
    </div>
  );
}

// 고른 뒤 그림이 생기기 전: 같은 자리에 구성된 계획과 실제 상태를 그대로 보여 준다
export function StatusSlot({
  candidate,
  spot,
  number,
  candidates,
  motifs,
}: {
  candidate: Candidate;
  spot: string;
  number: number;
  candidates: Candidate[];
  motifs: Motif[];
}) {
  const state = FIGURE_SPOTS[spot as keyof typeof FIGURE_SPOTS] ?? spot;
  return (
    <div className="figure-slot-card figure-slot-status" data-spot={spot}>
      <span className="figure-slot-text">
        <small role="status">{slotLabel(number, candidate, state)}</small>
        <FigurePlan candidate={candidate} candidates={candidates} motifs={motifs} />
      </span>
    </div>
  );
}
