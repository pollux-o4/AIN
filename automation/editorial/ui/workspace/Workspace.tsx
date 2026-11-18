import { useEffect, useRef, useState } from "react";
import { type ActionCommand, figureUrl, type Run } from "../shared/api";
import { Icon } from "../shared/Icon";
import { withOccurrenceKeys } from "../shared/listKeys";
import { ExecutionRecord, Monitor, WorkHeading } from "../tracking/Monitor";
import { Artifacts } from "./Artifacts";
import { EditMemo } from "./EditMemo";
import { ExportMenu } from "./ExportMenu";
import { type StagePick, WorkDock } from "./WorkDock";
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
  const [picked, setPicked] = useState<StagePick | null>(null);
  const previous =
    run?.previous.filter((draft) => draft.text && draft.revision !== run.textRevision) ?? [];
  return (
    <section id="workspace" hidden={!run} aria-labelledby="work-title">
      {run && (
        <>
          <WorkHeading run={run} online={online} submitting={submitting} onAction={onAction} />
          <Monitor
            run={run}
            online={online}
            onPick={(stage, name, live) => setPicked({ stage, name, live, at: Date.now() })}
          />
          <ExecutionRecord key={run.id} run={run} open={historyOpen} onOpen={setHistoryOpen} />
          <WritingDesign design={run.design} />
          <section id="result" hidden={!run.text} aria-label="본문">
            <div className="result-heading flex justify-end items-center gap-4">
              <span id="displayed-revision" className="hint" hidden={!run.text}>
                {run.textRevision === run.revision ? "현재" : "이전"} 초안 {run.textRevision}
              </span>
              <ExportMenu run={run} online={online} />
            </div>
            <Article html={run.html} />
            {run.figure?.phase === "confirmed" && (
              <p id="figure-files" className="hint">
                확인한 시각자료 파일:{" "}
                {run.figure.items.map((item, index) => (
                  <a
                    key={item.id}
                    className="download"
                    href={`${figureUrl(run, item.id)}&download`}
                    download
                  >
                    <Icon name="download" />
                    시각자료 {index + 1} SVG
                  </a>
                ))}
              </p>
            )}
            <EditMemo run={run} />
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
          <WorkDock
            run={run}
            online={online}
            disabled={!online || submitting}
            onAction={onAction}
            onNotice={onNotice}
            picked={picked}
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
