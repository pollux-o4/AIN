import { useEffect, useRef, useState } from "react";
import type { ActionCommand, Run } from "../shared/api";
import { Icon } from "../shared/Icon";
import { ExecutionHistory } from "./ExecutionHistory";
import { nextStep } from "./journey";

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
          <Icon name="pause" />
          중단
        </button>
        <button
          type="button"
          id="resume"
          hidden={!monitor.canResume}
          disabled={!online || submitting}
          onClick={() => void onAction({ type: "resume" })}
        >
          <Icon name="play" />
          {monitor.resumeLabel}
        </button>
      </div>
    </div>
  );
}
export function Monitor({
  run,
  online,
  onPick,
}: {
  run: Run;
  online: boolean;
  onPick?: (stage: string, name: string, live: boolean) => void;
}) {
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
  const next = nextStep(run, online);
  const track = useRef<HTMLElement>(null);
  const shape = monitor.pipeline.map((step) => step.status).join();
  // 좁은 화면에서 지도가 넘치면 지금 단계를 가운데로 보낸다 · 폭이 바뀌면 다시 맞춘다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 단계 상태가 바뀌면 지금 단계 위치가 달라진다
  useEffect(() => {
    const box = track.current;
    if (!box) return;
    const center = () => {
      const focus = box.querySelector<HTMLElement>("[data-focus]");
      if (focus) box.scrollLeft = focus.offsetLeft - box.clientWidth / 2 + focus.clientWidth / 2;
    };
    center();
    const observer = new ResizeObserver(center);
    observer.observe(box);
    return () => observer.disconnect();
  }, [shape]);
  const hasActive = monitor.pipeline.some((step) => step.status === "active");
  const firstOpen = monitor.pipeline.findIndex((step) => step.status !== "done");
  // 진행 중 단계가 없으면 멈춘 곳(실패·중단·대기), 모두 끝났으면 마지막 단계에 안내자를 둔다.
  const focus = firstOpen === -1 ? monitor.pipeline.length - 1 : firstOpen;
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
      <section className="journey" aria-label="진행 여정">
        <p id="next-step" data-tone={next.tone}>
          {next.say}
        </p>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: 가로로 넘치는 지도는 키보드로 스크롤할 수 있어야 한다 */}
        <section className="track" ref={track} tabIndex={0} aria-label="진행 여정 지도">
          <ol id="pipeline" aria-label="진행 단계" hidden={!monitor.pipeline.length}>
            {monitor.pipeline.map((step, i) => (
              <li
                key={step.stage}
                data-status={step.status}
                data-focus={
                  step.status === "active" || (!hasActive && i === focus) ? "" : undefined
                }
                aria-current={step.status === "active" ? "step" : undefined}
              >
                {onPick && step.status !== "pending" ? (
                  <button
                    type="button"
                    className="stage-pick"
                    aria-label={`${step.name} 단계 기록 보기`}
                    onClick={() => onPick(step.stage, step.name, step.status === "active")}
                  >
                    <i className="node" aria-hidden="true" />
                    <span>{step.name}</span>
                  </button>
                ) : (
                  <>
                    <i className="node" aria-hidden="true" />
                    <span>{step.name}</span>
                  </>
                )}
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
          <div className="chest" data-open={run.status.startsWith("publication") ? "" : undefined}>
            <i className="node" aria-hidden="true" />
            <span>전달</span>
          </div>
        </section>
      </section>
      <p
        id="issue"
        className="issue"
        // 실패 사유는 "지금 할 일" 한 줄이 이미 말한다
        hidden={
          !run.issue ||
          run.status === "failed" ||
          (run.needsCompletion && run.issue === run.completionReason)
        }
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
