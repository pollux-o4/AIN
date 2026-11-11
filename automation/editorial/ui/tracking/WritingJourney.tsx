import type { WritingJourneyEntry } from "../shared/api";
import { withOccurrenceKeys } from "../shared/listKeys";

export function WritingJourney({
  entries,
  revision,
}: {
  entries: WritingJourneyEntry[];
  revision: number;
}) {
  return (
    <section id="writing-journey" aria-label="작성과 수정 과정">
      {[...entries].reverse().map((entry) => (
        <details key={entry.revision} open={entry.revision === revision}>
          <summary>
            초안 {entry.revision} · {entry.revision === revision ? "현재" : "이전"}
          </summary>
          {entry.request && (
            <div className="journey-request">
              <h3>요청한 수정</h3>
              <p>{entry.request}</p>
            </div>
          )}
          {entry.summary && (
            <div>
              <h3>{entry.revision === 1 ? "작성 요약" : "수정 요약"}</h3>
              <p>{entry.summary}</p>
            </div>
          )}
          {entry.direction.length > 0 && (
            <div>
              <h3>작성 방향</h3>
              <dl>
                {entry.direction.map((choice) => (
                  <div key={choice.label}>
                    <dt>{choice.label}</dt>
                    <dd>
                      {choice.text}
                      {choice.reason && <p className="hint">{choice.reason}</p>}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {entry.findings.length > 0 && (
            <div>
              <h3>읽으며 확인할 점</h3>
              <ul>
                {withOccurrenceKeys(entry.findings.slice(0, 2)).map(({ value, key }) => (
                  <li key={key}>{value}</li>
                ))}
              </ul>
              {entry.findings.length > 2 && (
                <details>
                  <summary>확인할 내용 {entry.findings.length - 2}개 더 보기</summary>
                  <ul>
                    {withOccurrenceKeys(entry.findings.slice(2)).map(({ value, key }) => (
                      <li key={key}>{value}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {!entry.hasDraft && !entry.summary && entry.direction.length === 0 && (
            <p className="hint">아직 보존된 작성 결과가 없습니다.</p>
          )}
        </details>
      ))}
    </section>
  );
}
