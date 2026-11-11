import { useEffect, useRef, useState } from "react";
import { INPUT_LIMITS } from "../../../contracts/requests.mjs";
import type { ActionCommand, Run } from "../shared/api";
import { withOccurrenceKeys } from "../shared/listKeys";
import { keys, savedFeedback, storageWarning, store } from "../shared/persistence";
import { LiveActivity } from "../tracking/LiveActivity";
import { ExecutionRecord, Monitor, WorkHeading } from "../tracking/Monitor";
import { CompletionNotice, DraftApproval } from "./Actions";
import { Artifacts } from "./Artifacts";
import { WritingDesign } from "./WritingDesign";

function Article({ html }: { html: string }) {
  const article = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = article.current;
    if (!element || !html) return;
    Array.from(element.children).forEach((child, index) => {
      if (child instanceof HTMLElement) child.style.setProperty("--i", String(index));
    });
    element.classList.remove("fresh");
    void element.offsetWidth;
    element.classList.add("fresh");
  }, [html]);
  // HTML은 동일 출처 서버의 markdown-it(html: false) 렌더링 결과만 사용한다.
  // biome-ignore lint/security/noDangerouslySetInnerHtml: 동일 출처 서버가 markdown-it html:false로 렌더링한 HTML만 사용
  return <article id="article" ref={article} dangerouslySetInnerHTML={{ __html: html }} />;
}
function Feedback({
  run,
  disabled,
  onAction,
  onNotice,
}: {
  run: Run;
  disabled: boolean;
  onAction: (command: ActionCommand) => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [feedback, setFeedback] = useState(() => {
    const saved = savedFeedback();
    return saved?.id === run.id ? saved.text : "";
  });
  useEffect(() => {
    const saved = savedFeedback();
    setFeedback(saved?.id === run.id ? saved.text : "");
  }, [run]);
  return (
    <form
      id="feedback-form"
      hidden={!run.canFeedback}
      onSubmit={(event) => {
        event.preventDefault();
        void onAction({ type: "feedback", feedback });
      }}
    >
      <label htmlFor="feedback">어떻게 다듬을까요?</label>
      <textarea
        id="feedback"
        required
        maxLength={INPUT_LIMITS.feedback}
        rows={3}
        value={feedback}
        onChange={(event) => {
          const text = event.target.value;
          setFeedback(text);
          if (!store(keys.feedback, { id: run.id, text })) onNotice(storageWarning);
        }}
        placeholder="예: 주문·결제·배송 예시를 더 구체적으로 풀어 주세요."
      />
      <div className="submit-row">
        <button id="feedback-submit" type="submit" disabled={disabled}>
          수정 요청
        </button>
      </div>
    </form>
  );
}
export function Workspace({
  run,
  online,
  submitting,
  onAction,
  onNotice,
}: {
  run: Run | null;
  online: boolean;
  submitting: boolean;
  onAction: (command: ActionCommand) => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const previous =
    run?.previous.filter((draft) => draft.text && draft.revision !== run.textRevision) ?? [];
  return (
    <section id="workspace" hidden={!run} aria-labelledby="work-title">
      {run && (
        <>
          <WorkHeading run={run} online={online} submitting={submitting} onAction={onAction} />
          <Monitor run={run} online={online} />
          <LiveActivity key={`${run.id}:${run.revision}`} run={run} online={online} />
          <ExecutionRecord key={run.id} run={run} open={historyOpen} onOpen={setHistoryOpen} />
          <WritingDesign design={run.design} />
          <CompletionNotice run={run} disabled={!online || submitting} onAction={onAction} />
          <section id="result" hidden={!run.text} aria-label="본문">
            <div className="result-heading flex justify-end items-center gap-4">
              <span id="displayed-revision" className="hint" hidden={!run.text}>
                {run.textRevision === run.revision ? "현재" : "이전"} 초안 {run.textRevision}
              </span>
              <a
                id="download"
                className="download"
                href={`/write/api/runs/${run.id}/download`}
                download
                hidden={!run.canDownload}
                aria-disabled={!online}
                onClick={(event) => {
                  if (!online) event.preventDefault();
                }}
              >
                TXT 내려받기
              </a>
            </div>
            <Article html={run.html} />
            <section id="review" hidden={!run.findings.length} aria-labelledby="review-title">
              <h2 id="review-title">AI 검토 의견</h2>
              <p className="hint">사실·출처는 직접 확인해 주세요.</p>
              <ul id="findings">
                {withOccurrenceKeys(run.findings).map(({ value: finding, key }) => (
                  <li key={key}>{finding}</li>
                ))}
              </ul>
            </section>
          </section>
          <DraftApproval run={run} disabled={!online || submitting} onAction={onAction} />
          <Feedback
            run={run}
            disabled={!online || submitting}
            onAction={onAction}
            onNotice={onNotice}
          />
          <details id="stage-details" className="advanced" hidden={!run.artifacts.length}>
            <summary>상세 작성 자료</summary>
            <Artifacts run={run} />
          </details>
          <section id="history-section" hidden={!previous.length} aria-labelledby="history-title">
            <h2 id="history-title">이전 초안</h2>
            <div id="history">
              {previous.map((draft) => (
                <details key={draft.revision}>
                  <summary>초안 {draft.revision} 보기</summary>
                  <a
                    href={`/write/api/runs/${run.id}/download?revision=${draft.revision}`}
                    download
                  >
                    이 초안 내려받기
                  </a>
                  <pre>{draft.text}</pre>
                </details>
              ))}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
