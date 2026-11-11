import type { ActionCommand, Run } from "../shared/api";

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

export function DraftApproval({ run, disabled, onAction }: Props) {
  const approved = ["satisfied", "publication_ready"].includes(run.status);
  if (!run.canSatisfy && !run.canAuthorizePublication && !approved) return null;
  return (
    <section id="draft-approval" aria-labelledby="approval-title">
      <h2 id="approval-title">초안 확인과 발행 준비</h2>
      {approved && <p>초안을 확정했습니다.</p>}
      {run.status === "publication_ready" && <p>발행 준비를 승인했습니다.</p>}
      <p className="hint">실제 발행은 별도로 진행합니다.</p>
      <div className="approval-actions">
        {run.canSatisfy && (
          <button
            id="satisfy"
            type="button"
            disabled={disabled}
            onClick={() => void onAction({ type: "satisfy" })}
          >
            초안 확정
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
      </div>
      {approved && run.canFeedback && (
        <p className="hint">수정 요청 후에는 초안 확정과 발행 준비 승인이 다시 필요합니다.</p>
      )}
    </section>
  );
}
