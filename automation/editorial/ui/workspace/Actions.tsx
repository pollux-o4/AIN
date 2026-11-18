import { useState } from "react";
import type { ActionCommand, Run } from "../shared/api";
import { Icon } from "../shared/Icon";

type Props = {
  run: Run;
  disabled: boolean;
  onAction: (command: ActionCommand) => Promise<void>;
};

export function CompletionNotice({ run, disabled, onAction }: Props) {
  if (!run.needsCompletion) return null;
  return (
    <section id="completion-notice" className="issue" aria-labelledby="completion-title">
      <h2 id="completion-title">필수 단계 보완이 필요합니다</h2>
      <p id="completion-reason">{run.completionReason}</p>
      <p>기존 초안과 이전 기록을 보존하고, 새 회차에서 필수 8단계를 진행합니다.</p>
      <button
        id="complete-requirements"
        type="button"
        disabled={disabled || !run.canCompleteRequirements}
        onClick={() => void onAction({ type: "complete_requirements" })}
      >
        필수 단계 보완
      </button>
    </section>
  );
}

// 확정 뒤 두 갈래: 시각자료 추가(선택 단계) 또는 없이 발행 준비 승인 · 같은 위계 · FIGURE-001
export function DraftApproval({ run, disabled, onAction }: Props) {
  // 비우면 기본 기준(개념 소개 문단마다), 채우면 그 위치를 먼저 반영 · ADR-0011
  const [placement, setPlacement] = useState("");
  const note = placement.trim();
  const approved = ["satisfied", "publication_ready"].includes(run.status);
  if (!run.canSatisfy && !run.canAuthorizePublication && !approved) return null;
  const figures = run.figure?.phase === "confirmed" ? run.figure.items.length : 0;
  const published = run.status === "publication_ready";
  return (
    <section id="draft-approval" aria-labelledby="approval-title">
      <h2 id="approval-title">초안 확인과 발행 준비</h2>
      {approved && (
        <p id="approval-state">
          초안을 확정했습니다.
          {figures > 0 && ` 시각자료 ${figures}개를 확인했습니다.`}
          {published &&
            ` 발행 준비를 승인했습니다(${figures ? `본문과 시각자료 ${figures}개` : "본문만"}).`}
        </p>
      )}
      {run.canRequestFigures && (
        <p id="approval-guide">시각자료를 추가하거나, 없이 바로 발행 준비를 승인할 수 있습니다.</p>
      )}
      {!published && figures > 0 && (
        <p id="approval-guide">발행 준비를 승인하면 본문과 시각자료를 함께 넘길 준비가 끝납니다.</p>
      )}
      <p className="hint">실제 발행은 별도로 진행합니다.</p>
      <div className="approval-actions">
        {run.canSatisfy && (
          <button
            id="satisfy"
            type="button"
            disabled={disabled}
            onClick={() => void onAction({ type: "satisfy" })}
          >
            <Icon name="check" />
            초안 확정
          </button>
        )}
        {run.canRequestFigures && (
          <button
            id="request-figures"
            type="button"
            disabled={disabled}
            aria-describedby="request-figures-cost"
            onClick={() =>
              void onAction(
                note ? { type: "request_figures", feedback: note } : { type: "request_figures" },
              )
            }
          >
            <Icon name="image" />
            시각자료 추가
          </button>
        )}
        {run.canAuthorizePublication && (
          <button
            id="authorize-publication"
            type="button"
            disabled={disabled}
            onClick={() => void onAction({ type: "authorize_publication" })}
          >
            발행 준비 승인
          </button>
        )}
        {approved && run.canDiscardFigures && (
          <button
            id="discard-figures"
            type="button"
            className="quiet"
            disabled={disabled}
            onClick={() => void onAction({ type: "discard_figures" })}
          >
            시각자료 빼기
          </button>
        )}
      </div>
      {run.canRequestFigures && (
        <>
          <p id="request-figures-cost" className="hint">
            시각자료는 AI가 개념을 소개하는 문단마다 위치를 제안하고(AI 호출), 고른 문장 뒤에만
            놓입니다. 본문은 바뀌지 않습니다.
          </p>
          <details className="figure-placement">
            <summary>위치 직접 지정(선택)</summary>
            <label htmlFor="figure-placement">넣고 싶은 위치나 그림 내용</label>
            <textarea
              id="figure-placement"
              rows={3}
              maxLength={2000}
              placeholder="예: 1구간 레이어드 문단 뒤에 복층 주택 그림"
              value={placement}
              disabled={disabled}
              onChange={(event) => setPlacement(event.target.value)}
            />
            <p className="hint">적은 위치를 먼저 후보로 넣고, 나머지는 기본 기준으로 채웁니다.</p>
          </details>
        </>
      )}
      {approved && run.canFeedback && (
        <p className="hint">
          수정 요청 후에는 초안 확정{figures > 0 && "·시각자료 확인"}과 발행 준비 승인이 다시
          필요합니다.
        </p>
      )}
    </section>
  );
}
