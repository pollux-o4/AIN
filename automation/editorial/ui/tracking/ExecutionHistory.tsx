import { useEffect, useState } from "react";
import {
  api,
  errorMessage,
  type HistoryRecord,
  type Run,
  type WritingJourneyEntry,
} from "../shared/api";
import { StageOutput } from "../shared/StageOutput";
import { WritingJourney } from "./WritingJourney";

const time = (at: number) => new Date(at).toLocaleString("ko-KR", { hour12: false });
export function ExecutionHistory({ run, open }: { run: Run; open: boolean }) {
  const [loaded, setLoaded] = useState<{
    id: string;
    records: HistoryRecord[];
    journey: WritingJourneyEntry[];
  } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const eventCount = run.monitor.events.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 단계 기록·회차 변경과 수동 재조회 시 저장 기록 갱신
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    setError("");
    void api.history(run.id).then(
      (data) => {
        if (!disposed) setLoaded({ id: run.id, records: data.records, journey: data.journey });
      },
      (cause: unknown) => {
        if (!disposed) setError(errorMessage(cause));
      },
    );
    return () => {
      disposed = true;
    };
  }, [run.id, run.version, eventCount, open, retry]);
  const records = loaded?.id === run.id ? loaded.records : null;
  return (
    <>
      {!records && !error && open && <p aria-live="polite">작성·수정 과정을 불러오고 있습니다.</p>}
      {error && (
        <p className="issue">
          {error}{" "}
          <button type="button" className="quiet" onClick={() => setRetry(retry + 1)}>
            기록 다시 불러오기
          </button>
        </p>
      )}
      {loaded?.id === run.id && <WritingJourney entries={loaded.journey} revision={run.revision} />}
      <details className="technical-history">
        <summary>문제 진단용 실행 기록</summary>
        <p id="execution-info">
          {run.model} · 이번 요청 {run.callsUsed}/{run.maxCalls}회
        </p>
        <div
          id="execution-links"
          className="flex flex-wrap gap-x-[18px] gap-y-2.5"
          hidden={!run.executionLinks.length}
        >
          {run.executionLinks.map((link) => (
            <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer">
              n8n 실행 {link.id}
            </a>
          ))}
        </div>
        <a
          id="ai-console"
          href="http://localhost:6767/"
          target="_blank"
          rel="noopener noreferrer"
          hidden={!run.monitor.needsAiAttention}
        >
          AI 확인 화면
        </a>

        <ol id="trace" hidden={!run.monitor.events.length}>
          {(
            records ?? run.monitor.events.map((event, index) => ({ ...event, key: String(index) }))
          ).map((event, index) => {
            const record = records?.[index];
            const execution = run.executionLinks.find((link) => link.id === record?.executionId);
            return (
              <li key={event.key} data-stage={record?.stage} data-revision={event.revision}>
                <time dateTime={new Date(event.at).toISOString()}>{time(event.at)}</time>
                <div className="history-entry">
                  {index === 0 ||
                  (records ?? run.monitor.events)[index - 1].revision !== event.revision ? (
                    <h3>초안 {event.revision}</h3>
                  ) : null}
                  {record && (record.goal || record.reason || record.output) ? (
                    <details>
                      <summary>{event.label}</summary>
                      {record.goal && <p>{record.goal}</p>}
                      {record.inputs.length > 0 && (
                        <p className="hint">사용한 자료: {record.inputs.join(" · ")}</p>
                      )}
                      {record.inputsSource === "reconstructed" && (
                        <p className="hint">
                          사용한 자료의 종류는 당시 저장 상태에서 재구성했습니다.
                        </p>
                      )}
                      {record.model && <p className="hint">AI: {record.model}</p>}
                      {record.reason && <p>{record.reason}</p>}
                      {record.target && <p>다음 작업: {record.target}</p>}
                      {execution && (
                        <a href={execution.url} target="_blank" rel="noopener noreferrer">
                          이 단계의 n8n 실행 보기
                        </a>
                      )}
                      {record.resultSource === "artifact" && (
                        <p className="hint">
                          당시 실행 파일이 없어 현재 보존된 단계 결과를 표시합니다.
                        </p>
                      )}
                      {record.output && <StageOutput stage={record.stage} output={record.output} />}
                      {record.unavailable && (
                        <p className="hint">
                          당시 실행의 상세 자료를 찾을 수 없습니다. 확인된 시각과 상태만 표시합니다.
                        </p>
                      )}
                    </details>
                  ) : (
                    <span>{event.label}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </details>
      {open && !eventCount && (
        <p className="hint">
          이 작업에는 당시 실행 기록이 없습니다. 보존된 단계별 결과와 이전 초안을 확인해 주세요.
        </p>
      )}
    </>
  );
}
