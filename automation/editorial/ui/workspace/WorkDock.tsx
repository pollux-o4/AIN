import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ActionCommand, Run } from "../shared/api";
import { Icon } from "../shared/Icon";
import { keys, savedFeedback, storageWarning, store } from "../shared/persistence";
import { useHeightMorph } from "../shared/useHeightMorph";
import { LiveActivity } from "../tracking/LiveActivity";
import { StageLog } from "../tracking/StageLog";
import { isPending } from "../tracking/useRunTracking";
import { CompletionNotice, DraftApproval } from "./Actions";
import { BriefApproval } from "./BriefApproval";
import { dockLabels } from "./dockLabels";
import { FeedbackForm } from "./FeedbackForm";
import { locateFigure } from "./figures/articleMarks";
import { FigureChoice } from "./figures/FigureChoice";
import { FigureReview } from "./figures/FigureReview";
import type { FigureChoiceState } from "./figures/usePicked";

// 사용자 입력·결정은 모두 이 도크에서 받는다(DOCK-001) · 본문 흐름 밖에 떠 있어 읽던 위치를 잃지 않는다.
type Tab = "decide" | "live" | "log" | "feedback";
const tabNames: Record<Tab, string> = {
  decide: "확인",
  live: "실시간",
  log: "단계 기록",
  feedback: "수정 요청",
};
export type StagePick = { stage: string; name: string; live: boolean; at: number };

type Props = {
  run: Run;
  online: boolean;
  disabled: boolean;
  onAction: (command: ActionCommand) => Promise<void>;
  onNotice: (message: string) => void;
  picked?: StagePick | null;
  figureChoice?: FigureChoiceState | null;
};

export function WorkDock({
  run,
  online,
  disabled,
  onAction,
  onNotice,
  picked,
  figureChoice: choice,
}: Props) {
  const pending = isPending(run.status);
  // 작업이 사람을 기다리는 결정 · 도착하면 도크를 펼쳐 알린다
  const figureChoice = choice && run.figure ? run.figure : null;
  const figureReview = run.canConfirmFigures && run.figure ? run.figure : null;
  const blocking =
    Boolean(run.canApproveBrief && run.brief) ||
    run.needsCompletion ||
    Boolean(figureChoice || figureReview);
  const approved = ["satisfied", "publication_ready"].includes(run.status);
  const deciding = blocking || run.canSatisfy || run.canAuthorizePublication || approved;
  const tabs = [
    deciding && "decide",
    pending && "live",
    picked && "log",
    run.canFeedback && "feedback",
  ].filter(Boolean) as Tab[];
  // 새로고침 전 쓰던 요청이 있으면 펼친 채로 복구
  const [open, setOpen] = useState(() =>
    Boolean(savedFeedback()?.id === run.id && savedFeedback()?.text),
  );
  // 쓰던 수정 요청을 복구할 때는 그 탭으로 연다
  const [chosen, setChosen] = useState<Tab | null>(() =>
    savedFeedback()?.id === run.id && savedFeedback()?.text ? "feedback" : null,
  );
  const [text, setText] = useState("");
  const toggle = useRef<HTMLButtonElement>(null);
  const tab = chosen && tabs.includes(chosen) ? chosen : tabs[0];
  const content = useHeightMorph<HTMLDivElement>(tab);
  const blockingKey = blocking ? `${run.id}:${run.version}` : "";
  useEffect(() => {
    if (!blockingKey) return;
    setOpen(true);
    setChosen("decide");
  }, [blockingKey]);
  // 지도에서 단계를 누르면 그 단계 기록을 연다
  useEffect(() => {
    if (!picked) return;
    setOpen(true);
    // 지금 진행 중인 단계는 실시간 탭이 보여 준다
    setChosen(picked.live ? "live" : "log");
  }, [picked]);
  useEffect(() => {
    const saved = savedFeedback();
    setText(saved?.id === run.id ? saved.text : "");
  }, [run]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const write = (next: string) => {
    setText(next);
    if (!store(keys.feedback, { id: run.id, text: next })) onNotice(storageWarning);
  };
  const close = () => {
    setOpen(false);
    toggle.current?.focus();
  };
  // 결정을 보내면 접어 본문을 돌려준다 · 새 결정이 오면 위 effect가 다시 펼침
  const decide = (command: ActionCommand) => onAction(command).then(() => setOpen(false));
  // 본문 속 자리로 이동 · 도크를 접어 자리를 보이게 한다
  const locate = (id: string) => {
    setOpen(false);
    locateFigure(id);
  };
  const labels = dockLabels({
    run,
    blocking,
    pending,
    drafting: Boolean(text),
    picked: choice ? choice.picked.length : null,
    reviewingFigures: Boolean(figureReview),
  });
  // 조상 transform(등장 애니메이션)이 fixed 기준을 바꾸지 않게 body로 띄운다
  return createPortal(
    <aside
      id="work-dock"
      aria-label="작업 도크"
      data-open={open}
      data-live={pending && !blocking}
      hidden={!tab}
    >
      <div className="dock-shell">
        <div className="dock-bar">
          {open && tabs.length === 1 && tab && (
            <span className="dock-title">
              {tab === "decide"
                ? labels.decideTitle
                : tab === "log" && picked
                  ? `${picked.name} 기록`
                  : tabNames[tab]}
            </span>
          )}
          {open && tabs.length > 1 && (
            <div className="dock-tabs" role="tablist" aria-label="도크 탭">
              {tabs.map((name) => (
                <button
                  key={name}
                  id={`dock-tab-${name}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === name}
                  aria-controls="dock-panel"
                  onClick={() => setChosen(name)}
                >
                  {tabNames[name]}
                </button>
              ))}
            </div>
          )}
          <button
            ref={toggle}
            type="button"
            className="dock-toggle"
            aria-expanded={open}
            aria-controls="dock-panel"
            onClick={() => (open ? close() : setOpen(true))}
          >
            <span className="dock-glyph">
              <Icon name={open ? "close" : pending ? "eye" : "pen"} />
            </span>
            <span className="dock-label">{open ? "접기" : labels.closedLabel}</span>
            {!open && labels.dot && <span className="dock-dot" title={labels.dot} />}
          </button>
        </div>
        <section
          className="dock-body"
          id="dock-panel"
          aria-label={tab ? tabNames[tab] : undefined}
          inert={!open}
        >
          <div className="dock-content" ref={content}>
            {tab === "decide" && (
              <div className="dock-decide">
                <CompletionNotice run={run} disabled={disabled} onAction={decide} />
                {run.canApproveBrief && run.brief && (
                  <section id="brief-check" aria-label="수정 해석 확인">
                    <BriefApproval
                      key={`${run.id}:${run.version}`}
                      brief={run.brief}
                      disabled={disabled}
                      onAction={decide}
                    />
                  </section>
                )}
                {figureChoice && choice && (
                  <section aria-label="시각자료 위치 선택">
                    <FigureChoice
                      figure={figureChoice}
                      choice={choice}
                      onLocate={locate}
                      disabled={disabled}
                      onAction={decide}
                    />
                  </section>
                )}
                {figureReview && (
                  <section aria-label="시각자료 확인">
                    <FigureReview
                      key={`${run.id}:${run.version}`}
                      run={run}
                      figure={figureReview}
                      disabled={disabled}
                      onAction={decide}
                      onLocate={locate}
                    />
                  </section>
                )}
                <DraftApproval run={run} disabled={disabled} onAction={decide} />
              </div>
            )}
            {tab === "live" && (
              <div className="dock-live">
                <LiveActivity key={`${run.id}:${run.revision}`} run={run} online={online} />
                {/* 지켜보다 바로 멈출 수 있게 · 모바일 시트가 위쪽 중단 버튼을 가려도 닿는다 */}
                {run.monitor.canPause && (
                  <div className="submit-row">
                    <button
                      id="dock-pause"
                      aria-label="작업 중단"
                      type="button"
                      className="quiet"
                      disabled={disabled}
                      onClick={() => void onAction({ type: "pause" })}
                    >
                      <Icon name="pause" />
                      중단
                    </button>
                  </div>
                )}
              </div>
            )}
            {tab === "log" && picked && (
              <section className="dock-log" aria-label={`${picked.name} 단계 기록`}>
                {/* 새 결과가 오면 다시 불러온다 */}
                <StageLog key={run.version} run={run} stage={picked.stage} />
              </section>
            )}
            {tab === "feedback" && (
              <FeedbackForm
                text={text}
                disabled={disabled}
                autoFocus={open}
                onWrite={write}
                onAction={onAction}
                onSent={() => setOpen(false)}
              />
            )}
          </div>
        </section>
      </div>
    </aside>,
    document.body,
  );
}
