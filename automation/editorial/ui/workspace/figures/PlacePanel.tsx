import { useEffect, useRef, useState } from "react";
import { FIGURE_LIMITS, FIGURE_PLACE_ERRORS } from "../../../../contracts/figure.mjs";
import { Icon } from "../../shared/Icon";

// 범위 패널 조각 · 무엇을 보낼지는 PlaceFigure가 정하고 여기서는 표시·입력만 맡는다(ADR-0030)

const STEPS = [
  { edge: "start", grow: true, label: "앞 문장 +" },
  { edge: "start", grow: false, label: "앞 문장 −" },
  { edge: "end", grow: false, label: "뒷 문장 −" },
  { edge: "end", grow: true, label: "뒷 문장 +" },
] as const;
export function RangeSteps({ onStep }: { onStep: (edge: "start" | "end", grow: boolean) => void }) {
  return (
    <fieldset className="figure-place-steps">
      <legend className="sr-only">범위 한 문장씩 조절</legend>
      {STEPS.map(({ edge, grow, label }) => (
        <button key={label} type="button" className="quiet" onClick={() => onStep(edge, grow)}>
          {label}
        </button>
      ))}
    </fieldset>
  );
}

export function RangeClash({ number, onLocate }: { number: number; onLocate: () => void }) {
  return (
    <p className="figure-place-clash" role="status">
      {FIGURE_PLACE_ERRORS.overlaps} (후보 {number}){" "}
      <button type="button" onClick={onLocate}>
        그 후보 보기
      </button>
    </p>
  );
}

export function PanelActions({
  onCancel,
  children,
}: {
  onCancel: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="figure-place-actions">
      <button type="button" className="quiet" onClick={onCancel}>
        취소
      </button>
      {children}
    </div>
  );
}

// 새 자리: 먼저 「여기에 시각자료」, 누르면 보여 줄 것을 적는다
export function AddFigure({
  blocked,
  full,
  sending,
  onCancel,
  onAdd,
}: {
  blocked: boolean;
  full: boolean;
  sending: boolean;
  onCancel: () => void;
  onAdd: (claim: string) => void;
}) {
  const [writing, setWriting] = useState(false);
  const [claim, setClaim] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  // 입력을 펼치면 바로 적을 수 있게 초점을 옮긴다
  useEffect(() => {
    if (writing) input.current?.focus();
  }, [writing]);
  if (!writing)
    return (
      <div className="figure-place-actions">
        <button
          type="button"
          disabled={blocked || full}
          title={full ? FIGURE_PLACE_ERRORS.full : undefined}
          onClick={() => setWriting(true)}
        >
          <Icon name="image" />
          여기에 시각자료
        </button>
      </div>
    );
  return (
    <form
      className="figure-place-form"
      onSubmit={(event) => {
        event.preventDefault();
        onAdd(claim.trim());
      }}
    >
      <label>
        이 자리의 그림이 보여 줄 것
        <textarea
          rows={2}
          ref={input}
          required
          maxLength={FIGURE_LIMITS.claim}
          placeholder="예: 목록 주소와 개별 주소에 쓰는 메서드를 나눠 보여 준다"
          value={claim}
          onChange={(event) => setClaim(event.target.value)}
        />
      </label>
      <PanelActions onCancel={onCancel}>
        <button type="submit" disabled={!claim.trim() || blocked || sending}>
          후보로 추가
        </button>
      </PanelActions>
    </form>
  );
}
