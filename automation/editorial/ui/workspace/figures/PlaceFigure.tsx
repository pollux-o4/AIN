import { type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FIGURE_LIMITS } from "../../../../contracts/figure.mjs";
import type { ActionCommand } from "../../shared/api";
import { AddFigure, PanelActions, RangeClash, RangeSteps } from "./PlacePanel";
import { overlaps, selectPicked } from "./textIndex";
import type { FigureChoiceState } from "./usePicked";
import {
  useAnchoredPosition,
  useCandidateRanges,
  useSelectionPick,
  useTextIndex,
} from "./usePlacement";
import { useRangeHighlights } from "./useRangeHighlights";

// 본문 범위를 골라 시각자료 자리를 추가하거나 후보 범위를 바꾼다 · 위치 고르기 단계에서만(ADR-0030)
// 입력은 브라우저 기본 선택(끌기·Shift+화살표·터치 손잡이) · 문장 경계로 맞추고 끝은 한 문장씩 조절한다
// shortcut: 캐럿 브라우징 없이 키보드만으로 새 범위를 시작하는 길이 없다(조절은 문장 단위 버튼으로 가능), 키보드 사용자 요청이 오면 문장 단위 이동 모드 검토
export function PlaceFigure({
  article,
  html,
  choice,
  disabled,
  onAction,
  onLocate,
}: {
  article: RefObject<HTMLElement | null>;
  html: string;
  choice: FigureChoiceState;
  disabled: boolean;
  onAction: (command: ActionCommand) => Promise<void>;
  onLocate: (id: string) => void;
}) {
  const index = useTextIndex(article, html);
  const ranges = useCandidateRanges(index, choice.candidates);
  const panel = useRef<HTMLDivElement>(null);
  const { adjusting } = choice;
  const [picked, setPicked] = useSelectionPick(index, panel, adjusting !== null);
  const [sending, setSending] = useState(false);

  // 범위 조절 시작: 지금 범위를 선택해 두고 그 자리로 이동 · 시작할 때 한 번만(다시 그려져도 사람이 고친 범위를 덮지 않게)
  const started = useRef<string | null>(null);
  useEffect(() => {
    if (adjusting === started.current) return;
    const current = adjusting ? ranges.get(adjusting) : undefined;
    started.current = current ? adjusting : null;
    if (!current) return;
    selectPicked(current);
    setPicked(current);
    current.range.startContainer.parentElement?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [adjusting, ranges, setPicked]);

  const close = () => {
    setPicked(null);
    choice.adjust(null);
    window.getSelection()?.removeAllRanges();
  };
  useEffect(() => {
    if (!picked) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const clash = picked
    ? choice.candidates.find((c) => {
        const range = ranges.get(c.id);
        return c.id !== adjusting && range !== undefined && overlaps(range, picked);
      })
    : undefined;
  useRangeHighlights({
    candidate: [...ranges].flatMap(([id, range]) => (id === adjusting ? [] : [range])),
    focus: adjusting ? [ranges.get(adjusting)] : [],
    pick: [picked],
  });
  const at = useAnchoredPosition(disabled ? null : picked);
  if (disabled || !picked || !at || !index) return null;

  const send = async (command: ActionCommand) => {
    setSending(true);
    try {
      await onAction(command);
      close();
    } finally {
      setSending(false);
    }
  };
  const step = (edge: "start" | "end", grow: boolean) => {
    const next = index.step(picked, edge, grow);
    if (!next) return;
    selectPicked(next);
    setPicked(next);
  };
  const title = adjusting ? `후보 ${choice.numberOf(adjusting)} 범위` : "고른 범위";
  // 문서 본체에 띄운다 · 본문 쪽 조상의 transform이 화면 고정 위치의 기준을 바꾸지 않게
  return createPortal(
    <div
      ref={panel}
      className="figure-place"
      role="dialog"
      aria-label={adjusting ? `${title} 조절` : "시각자료 자리 추가"}
      style={{ top: at.top, left: at.left }}
    >
      <p className="figure-place-summary" aria-live="polite">
        {title} · {picked.quote.exact.length}자
      </p>
      <RangeSteps onStep={step} />
      {clash && (
        <RangeClash number={choice.numberOf(clash.id)} onLocate={() => onLocate(clash.id)} />
      )}
      {adjusting ? (
        <PanelActions onCancel={close}>
          <button
            type="button"
            disabled={Boolean(clash) || sending}
            onClick={() =>
              void send({ type: "place_figure", figure: adjusting, quote: picked.quote })
            }
          >
            이 범위로
          </button>
        </PanelActions>
      ) : (
        <AddFigure
          key={`${picked.start}:${picked.end}`}
          blocked={Boolean(clash)}
          full={choice.candidates.length >= FIGURE_LIMITS.candidates}
          sending={sending}
          onCancel={close}
          onAdd={(claim) => void send({ type: "place_figure", quote: picked.quote, claim })}
        />
      )}
    </div>,
    document.body,
  );
}
