import { useEffect, useRef, useState } from "react";
import type { Run } from "../shared/api";
import { previewFields } from "./preview";
import { useActivity } from "./useActivity";
import { isPending } from "./useRunTracking";

const labels = {
  queued: "AI 작업 연결을 기다리고 있습니다.",
  waiting: "AI 응답을 기다리고 있습니다.",
  generating: "답변을 생성하고 있습니다.",
  tool: "AI가 도구를 실행하고 있습니다.",
  validating: "응답이 도착했습니다. 결과를 확인하고 있습니다.",
  permission: "AI 실행에 승인이 필요합니다. AI 실행 보기를 확인해 주세요.",
  failed: "작업을 진행할 수 없습니다. 작업 안내를 확인해 주세요.",
  unavailable: "실시간 내용을 확인하지 못했습니다. 단계 상태는 계속 확인합니다.",
  complete: "단계 결과를 받았습니다.",
  paused: "작업이 중단됐습니다.",
};
export function LiveActivity({ run, online }: { run: Run; online: boolean }) {
  const { activity, connection } = useActivity(run.id, run.revision, run.status);
  const [follow, setFollow] = useState(true);
  const [now, setNow] = useState(Date.now());
  const preview = useRef<HTMLElement>(null);
  const pending = isPending(run.status);
  const fields = previewFields(activity?.text ?? "", activity?.stage ?? "");
  const contentKey = fields.map((field) => field.text).join("\n");
  useEffect(() => {
    if (contentKey && follow && preview.current)
      preview.current.scrollTop = preview.current.scrollHeight;
  }, [contentKey, follow]);
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending]);
  if (!pending && !activity?.text) return null;
  const disconnected = !online || connection === "reconnecting";
  const last = activity?.lastOutputAt;
  const idleSeconds = last ? Math.max(0, Math.floor((now - last) / 1000)) : null;
  const label = !pending
    ? run.status === "paused"
      ? labels.paused
      : "실시간 미리보기 기록"
    : disconnected
      ? "연결이 끊겼습니다. 받은 내용을 보존하고 자동으로 다시 연결합니다."
      : activity
        ? labels[activity.phase]
        : "실시간 작업에 연결하고 있습니다.";
  return (
    <section id="live-activity" aria-labelledby="live-title">
      <div className="live-heading">
        <h2 id="live-title">{activity?.name ?? "현재 작업"}</h2>
        <span className="hint">{pending ? (disconnected ? "재연결 중" : "실시간") : "기록"}</span>
      </div>
      <p aria-live="polite">{label}</p>
      {last && (
        <p className="hint">
          마지막 출력 {pending ? `${idleSeconds}초 전` : new Date(last).toLocaleTimeString("ko-KR")}
        </p>
      )}
      {pending && idleSeconds !== null && idleSeconds >= 20 && !disconnected && (
        <p className="hint">새 출력이 아직 없습니다. 기다리거나 위에서 중단할 수 있습니다.</p>
      )}
      {!fields.length && pending && <p className="hint">내용이 도착하면 여기에 표시됩니다.</p>}
      {fields.length > 0 && (
        <details open>
          <summary>{pending ? "생성 중인 내용" : "생성된 내용"} · 미완성</summary>
          <p className="hint">완료된 결과는 아래 단계별 결과에 반영됩니다.</p>
          <section
            className="live-preview"
            ref={preview}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: 스크롤 영역의 키보드 조작 지원
            tabIndex={0}
            aria-label="생성 중인 내용"
            onScroll={(event) => {
              const el = event.currentTarget;
              setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
            }}
          >
            {fields.map((field) => (
              <div key={field.label}>
                <h3>{field.label}</h3>
                <p>{field.text}</p>
              </div>
            ))}
          </section>
          {activity?.truncated && (
            <p className="hint">
              미리보기는 일부만 표시합니다. 완료된 전체 내용은 단계별 결과에서 확인하세요.
            </p>
          )}
          {!follow && (
            <button type="button" className="quiet" onClick={() => setFollow(true)}>
              최신 내용 따라가기
            </button>
          )}
        </details>
      )}
      {(activity?.phase === "permission" || activity?.phase === "unavailable") && (
        <a href="http://localhost:6767/" target="_blank" rel="noopener noreferrer">
          AI 실행 보기
        </a>
      )}
    </section>
  );
}
