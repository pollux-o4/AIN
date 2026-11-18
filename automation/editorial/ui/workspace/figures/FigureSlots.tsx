import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../shared/Icon";
import { marks } from "./articleMarks";
import { FigurePlan } from "./FigurePlan";
import { kindName } from "./plan";
import { useArticleTargets } from "./useArticleTargets";
import type { FigureChoiceState } from "./usePicked";

// 서버가 후보 앵커 문단 뒤에 둔 빈 자리에 선택 단추를 채운다 · 본문에서 바로 고르게(FIGURE-001)
export function FigureSlots({
  article,
  html,
  choice,
}: {
  article: RefObject<HTMLElement | null>;
  html: string;
  choice: FigureChoiceState;
}) {
  const slots = useArticleTargets(article, html, marks.slot);
  return slots.map((slot) => {
    const id = marks.candidateOf(slot);
    const candidate = choice.candidates.find((item) => item.id === id);
    if (!candidate) return null;
    const on = choice.picked.includes(id);
    return createPortal(
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
          <small>
            시각자료 후보 {choice.numberOf(id)}
            {kindName(candidate.kind) ? ` · ${kindName(candidate.kind)}` : ""} ·{" "}
            {on ? "만들 곳" : "제외"}
          </small>
          <FigurePlan candidate={candidate} candidates={choice.candidates} motifs={choice.motifs} />
        </span>
      </button>,
      slot,
      id,
    );
  });
}
