import { useEffect, useState } from "react";
import type { ActionCommand, Run } from "../shared/api";
import { ExecutionHistory } from "./ExecutionHistory";

const time = (at: number) =>
  new Date(at).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
const ago = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds}초` : `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
};
const labels = { done: "완료", active: "진행 중", paused: "중단", failed: "실패", pending: "대기" };
export function WorkHeading({
  run,
  online,
  submitting,
  onAction,
}: {
  run: Run;
  online: boolean;
  submitting: boolean;
  onAction: (command: ActionCommand) => Promise<void>;
}) {
  const monitor = run.monitor;
  return (
    <div className="work-heading flex justify-between items-start gap-6 max-[640px]:flex-col max-[640px]:gap-0">
      <div>
        <p className="eyebrow" id="revision">
          초안 {run.revision}
        </p>
        <h1 id="work-title" tabIndex={-1}>
          {run.title}
        </h1>
      </div>
      <div
        id="work-actions"
        className="flex gap-2.5 shrink-0"
        hidden={!monitor.canPause && !monitor.canResume}
      >
        <button
          type="button"
          id="pause"
          className="quiet"
          hidden={!monitor.canPause}
          disabled={!online || submitting}
          onClick={() => void onAction({ type: "pause" })}
        >
          중단
        </button>
        <button
          type="button"
          id="resume"
          hidden={!monitor.canResume}
          disabled={!online || submitting}
          onClick={() => void onAction({ type: "resume" })}
        >
          {monitor.resumeLabel}
        </button>
      </div>
    </div>
  );
}
export function Monitor({ run, online }: { run: Run; online: boolean }) {
  const monitor = run.monitor;
  const [clock, setClock] = useState(() => ({ server: monitor.now, local: Date.now() }));
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const local = Date.now();
    setClock({ server: monitor.now, local });
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Date.now() - local), 1000);
    return () => clearInterval(timer);
  }, [monitor.now]);
  const now = clock.server === monitor.now ? clock.server + elapsed : monitor.now;
  const kind = online ? monitor.kind : "offline";
  const active = ["working", "queued", "stale", "blocked"].includes(monitor.kind);
  const live = run.executionLinks.find((link) => link.id === monitor.executionId);
  const confirmed = monitor.lastConfirmedAt;
  return (
    <>
      <div className="status-line flex items-center gap-3.5 max-[640px]:flex-col max-[640px]:items-start max-[640px]:gap-[7px]">
        <span
          id="status"
          role="status"
          aria-live="polite"
          data-kind={kind}
          data-busy={["queued", "working"].includes(kind) ? "" : undefined}
        >
          {online ? monitor.label : "상태 확인 불가"}
        </span>
        <time
          id="confirmed"
          hidden={!confirmed || (online && !active)}
          dateTime={confirmed ? new Date(confirmed).toISOString() : undefined}
          data-at={confirmed ?? undefined}
          title={confirmed ? `${time(confirmed)} 확인` : undefined}
        >
          {confirmed ? `${ago(now - confirmed)} 전 확인` : ""}
        </time>
        <a
          id="n8n-live"
          className="live-link"
          target="_blank"
          rel="noopener noreferrer"
          hidden={!live || !active}
          href={live?.url}
        >
          n8n 실행 보기
        </a>
      </div>
      <ol id="pipeline" aria-label="진행 단계" hidden={!monitor.pipeline.length}>
        {monitor.pipeline.map((step) => (
          <li
            key={step.stage}
            data-status={step.status}
            aria-current={step.status === "active" ? "step" : undefined}
          >
            <span>{step.name}</span>
            <small
              data-since={step.status === "active" ? (step.startedAt ?? undefined) : undefined}
            >
              {labels[step.status]}
              {step.status === "done" && step.startedAt !== null && step.completedAt !== null
                ? ` · ${ago(step.completedAt - step.startedAt)}`
                : step.status === "active" && step.startedAt !== null
                  ? ` · ${ago(now - step.startedAt)}`
                  : ""}
            </small>
          </li>
        ))}
      </ol>
      <p
        id="issue"
        className="issue"
        hidden={!run.issue || (run.needsCompletion && run.issue === run.completionReason)}
      >
        {run.issue}
      </p>
    </>
  );
}
export function ExecutionRecord({
  run,
  open,
  onOpen,
}: {
  run: Run;
  open: boolean;
  onOpen: (open: boolean) => void;
}) {
  return (
    <details
      className="advanced"
      id="execution-record"
      open={open}
      onToggle={(event) => onOpen(event.currentTarget.open)}
    >
      <summary id="record-title">
        <h2>글이 만들어진 과정</h2>
      </summary>
      <ExecutionHistory run={run} open={open} />
      <details>
        <summary>처음 요청한 내용</summary>
        <p id="original-request">{run.idea}</p>
      </details>
    </details>
  );
}
