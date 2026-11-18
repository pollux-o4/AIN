import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Run } from "../shared/api";
import { ago } from "./clock";
import { type Next, trackPhases } from "./journey";
import { useFoldMotion } from "./useFoldMotion";

// 진행 여정 지도: 지금 할 일 한 줄, 단계 칸, 글 단계 접기(시각 단계로 넘어간 뒤), 전달 상자
const labels = { done: "완료", active: "진행 중", paused: "중단", failed: "실패", pending: "대기" };

export function JourneyMap({
  run,
  next,
  now,
  onPick,
}: {
  run: Run;
  next: Next;
  now: number;
  onPick?: (stage: string, name: string, live: boolean) => void;
}) {
  const monitor = run.monitor;
  const track = useRef<HTMLElement>(null);
  const phases = trackPhases(monitor.pipeline);
  const [unfolded, setUnfolded] = useState(false);
  // 다른 글로 바뀌거나 접을 조건이 사라지면 사용자가 펼쳐 둔 상태도 처음으로 돌린다
  // biome-ignore lint/correctness/useExhaustiveDependencies: 글이 바뀌는 것 자체가 초기화 신호
  useEffect(() => setUnfolded(false), [run.id, phases.foldable]);
  const folded = phases.foldable && !unfolded;
  const shown = folded ? phases.visual : monitor.pipeline;
  const list = useFoldMotion<HTMLOListElement>(`${run.id}:${folded}`);
  const writingKeys = phases.writing.map((step) => step.stage).join(" ");
  const shape = monitor.pipeline.map((step) => step.status).join();
  // 접힘 전환과 같은 프레임에 맞춰야 모션 출발점이 어긋나지 않는다 · 좁은 화면에서 지도가 넘치면 지금 단계를 가운데로 보낸다 · 폭이 바뀌면 다시 맞춘다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 단계 상태가 바뀌면 지금 단계 위치가 달라진다
  useLayoutEffect(() => {
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
  }, [shape, folded]);
  const hasActive = monitor.pipeline.some((step) => step.status === "active");
  const firstOpen = monitor.pipeline.findIndex((step) => step.status !== "done");
  // 진행 중 단계가 없으면 멈춘 곳(실패·중단·대기), 모두 끝났으면 마지막 단계에 안내자를 둔다.
  const focus = firstOpen === -1 ? monitor.pipeline.length - 1 : firstOpen;
  return (
    <section className="journey" aria-label="진행 여정">
      <p id="next-step" data-tone={next.tone}>
        {next.say}
      </p>
      {phases.foldable && unfolded && (
        <button
          type="button"
          className="quiet phase-unfold"
          aria-expanded={true}
          aria-controls="pipeline"
          onClick={() => setUnfolded(false)}
        >
          글 단계 접기
        </button>
      )}
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: 가로로 넘치는 지도는 키보드로 스크롤할 수 있어야 한다 */}
      <section className="track" ref={track} tabIndex={0} aria-label="진행 여정 지도">
        <ol id="pipeline" ref={list} aria-label="진행 단계" hidden={!monitor.pipeline.length}>
          {folded && (
            <li
              key="writing"
              data-key="writing"
              data-from={writingKeys}
              data-status="done"
              className="phase-fold"
            >
              <button
                type="button"
                className="stage-pick"
                aria-expanded={false}
                aria-label={`글 완성 · ${phases.writing.length}단계 펼쳐 보기`}
                onClick={() => setUnfolded(true)}
              >
                <i className="node" aria-hidden="true" />
                <span>글 완성</span>
              </button>
              <small className="phase-count">{phases.writing.length}단계</small>
            </li>
          )}
          {shown.map((step) => (
            <li
              key={step.stage}
              data-key={step.stage}
              data-from={folded ? undefined : "writing"}
              data-status={step.status}
              data-focus={
                step.status === "active" || (!hasActive && monitor.pipeline.indexOf(step) === focus)
                  ? ""
                  : undefined
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
  );
}
