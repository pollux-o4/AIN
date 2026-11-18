import { useState } from "react";
import type { z } from "zod";
import { labMatrix, type labSchema } from "../../../../contracts/lab.mjs";
import "./lab.css";

export type Lab = z.infer<typeof labSchema>;
type LabRecord = Lab["records"][number];
/** 결과 파일 주소 · "<사례>/<변형>/<단계>-<회차>/<파일>" → URL */
export type FileUrl = (key: string) => string | undefined;

const minutes = (ms: number | null) => (ms === null ? "—" : `${(ms / 60000).toFixed(1)}분`);
const tokens = (n: number | null) => (n === null ? "—" : `${Math.round(n / 10000)}만`);

function Record({ record, fileUrl }: { record: LabRecord; fileUrl: FileUrl }) {
  const base = `${record.case}/${record.variant}/${record.stage}-${record.trial}`;
  const sum = record.tokens ? record.tokens.input + record.tokens.output : null;
  return (
    <div className="lab-record">
      <div className="lab-head">
        <b>
          {record.stage === "plan" ? "위치 제안" : "그림"} {record.trial}회
        </b>
        <span>
          {minutes(record.ms)} · {tokens(sum)} 토큰
        </span>
        {record.verdict ? (
          <span
            className={record.verdict.pass ? "lab-pass" : "lab-fail"}
            title={record.verdict.note}
          >
            {record.verdict.pass ? "통과" : "미통과"} · {record.verdict.by}
          </span>
        ) : (
          <span className="lab-pending">판정 전</span>
        )}
      </div>
      {record.files.map((file) => {
        const url = fileUrl(`${base}/${file.path}`);
        return url ? (
          <a key={file.path} href={url} target="_blank" rel="noreferrer">
            <img src={url} alt={`${record.case} ${record.variant}`} loading="lazy" />
          </a>
        ) : (
          <p key={file.path} className="lab-missing">
            파일 없음: {file.path}
          </p>
        );
      })}
      {record.candidates && (
        <ol className="lab-candidates">
          {record.candidates.map((c) => (
            <li key={c.anchor}>
              <q>{c.anchor}</q>
              {c.relation && <em> {c.relation}</em>}
              {c.without && <small>없으면: {c.without}</small>}
              {c.mapping && (
                <small>대응: {c.mapping.map((m) => `${m.element}→${m.concept}`).join(", ")}</small>
              )}
            </li>
          ))}
        </ol>
      )}
      <div className="lab-foot">
        {record.visual
          ? `렌더 ${record.visual.renders} · 열람 ${record.visual.views} · 열람 뒤 수정 ${record.visual.editsAfterView}`
          : "시각 확인 기록 없음"}
        {record.model && ` · ${record.model}`}
        {record.note && ` · ${record.note}`}
        {record.verdict?.note && <p>판정 메모: {record.verdict.note}</p>}
      </div>
    </div>
  );
}

// 연구소 비교판 · 사례(행) × 변형(열) · 기준 변형이 첫 열 (LAB-001)
export function LabBoard({ lab, fileUrl }: { lab: Lab; fileUrl: FileUrl }) {
  const [stage, setStage] = useState<"all" | "plan" | "figure">("all");
  const { variants, rows } = labMatrix(lab);
  if (rows.length === 0)
    return (
      <section className="lab">
        <h1>시각자료 연구소</h1>
        <p>
          기록이 없습니다. <code>mise run lab -- index</code> 로 색인을 만들거나 실행 기록을
          가져오세요 (<code>node automation/paseo/lab/import-jobs.mjs</code>).
        </p>
      </section>
    );
  return (
    <section className="lab">
      <h1>시각자료 연구소</h1>
      <div className="lab-filter" role="radiogroup" aria-label="단계">
        {(["all", "plan", "figure"] as const).map((value) => (
          <label key={value}>
            <input type="radio" checked={stage === value} onChange={() => setStage(value)} />
            {{ all: "전체", plan: "위치 제안", figure: "그림" }[value]}
          </label>
        ))}
      </div>
      <div
        className="lab-grid"
        style={{ gridTemplateColumns: `8rem repeat(${variants.length}, minmax(18rem, 1fr))` }}
      >
        <div />
        {variants.map((v) => (
          <div key={v.id} className="lab-variant">
            <b>{v.label}</b>
            <p>{v.hypothesis}</p>
            {v.changes.length > 0 && (
              <ul>
                {v.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {rows.map((row) => {
          const cells = row.cells.map((cell) => ({
            ...cell,
            records: cell.records.filter((r) => stage === "all" || r.stage === stage),
          }));
          if (cells.every((c) => c.records.length === 0)) return null;
          return [
            <div key={`${row.case}-h`} className="lab-case">
              {row.case}
            </div>,
            ...cells.map((cell) => (
              <div key={`${row.case}-${cell.variant}`} className="lab-cell">
                {cell.records.length === 0 ? (
                  <p className="lab-missing">아직 실행하지 않음</p>
                ) : (
                  <>
                    <p className="lab-summary">
                      {cell.summary.trials}회 · 중앙 {minutes(cell.summary.ms)} ·{" "}
                      {tokens(cell.summary.tokens)} 토큰 · 판정 {cell.summary.passed}/
                      {cell.summary.judged}
                    </p>
                    {cell.records.map((r) => (
                      <Record key={`${r.stage}-${r.trial}`} record={r} fileUrl={fileUrl} />
                    ))}
                  </>
                )}
              </div>
            )),
          ];
        })}
      </div>
    </section>
  );
}
