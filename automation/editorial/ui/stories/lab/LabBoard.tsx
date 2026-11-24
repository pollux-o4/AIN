import { useState } from "react";
import type { z } from "zod";
import { labMatrix, type labSchema } from "../../../../contracts/lab.mjs";
import "./lab.css";

export type Lab = z.infer<typeof labSchema>;
type LabRecord = Lab["records"][number];
/** 결과 파일 주소 · "<사례>/<변형>/<단계>-<회차>/<파일>" → URL */
export type FileUrl = (key: string) => string | undefined;

// 연구소 단계 이름 · ADR-0026
const STAGE_NAMES = { plan: "위치 제안", compose: "구성", figure: "그림" } as const;
const minutes = (ms: number | null) => (ms === null ? "—" : `${(ms / 60000).toFixed(1)}분`);
const tokens = (n: number | null) => (n === null ? "—" : `${Math.round(n / 10000)}만`);

// 정해진 씨앗으로 섞는다 · 같은 기록에서는 같은 순서라 판정 중에 열이 바뀌지 않는다
function shuffled(items: number[], seed: number) {
  const out = [...items];
  let x = seed + 7;
  for (let i = out.length - 1; i > 0; i--) {
    x = (x * 1103515245 + 12345) % 2147483648;
    const j = x % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

type Candidate = NonNullable<LabRecord["candidates"]>[number];

// 3단: 자리를 펼쳐야 장면·대응표가 보인다 · 한 줄 요약은 id·앵커·그릴 대상
function CandidateLine({ c }: { c: Candidate }) {
  const detail = c.scene || c.without || c.relation || c.mapping?.length;
  const line = (
    <>
      {c.id && <b>{c.id}</b>} <q>{c.anchor}</q>
      {c.analogy ? <em> → {c.analogy}</em> : <span className="lab-muted"> · 비유 없음</span>}
    </>
  );
  if (!detail) return <li>{line}</li>;
  return (
    <li>
      <details>
        <summary>{line}</summary>
        {c.relation && <p>관계: {c.relation}</p>}
        {c.scene && <p>장면: {c.scene}</p>}
        {c.without && <p>없으면: {c.without}</p>}
        {c.mapping && (
          <ul>
            {c.mapping.map((m) => (
              <li key={`${m.element}:${m.concept}`}>
                {m.element} → {m.concept}
              </li>
            ))}
          </ul>
        )}
      </details>
    </li>
  );
}

// 1단 요약 · 자리 수와 그릴 대상이 정해진 수만 센다
function countLabel(record: LabRecord) {
  const list = record.candidates ?? [];
  if (!list.length) return null;
  const named = list.filter((c) => c.analogy).length;
  return record.stage === "plan" ? `자리 ${list.length}` : `자리 ${list.length} · 비유 ${named}`;
}

function Record({
  record,
  fileUrl,
  blind,
}: {
  record: LabRecord;
  fileUrl: FileUrl;
  blind: boolean;
}) {
  const base = `${record.case}/${record.variant}/${record.stage}-${record.trial}`;
  const sum = record.tokens ? record.tokens.input + record.tokens.output : null;
  const count = countLabel(record);
  const head = (
    <span className="lab-head">
      <b>
        {STAGE_NAMES[record.stage]} {record.trial}회
      </b>
      {count && <span>{count}</span>}
      {!blind && (
        <span className="lab-muted">
          {[record.ms === null ? null : minutes(record.ms), `${tokens(sum)} 토큰`]
            .filter(Boolean)
            .join(" · ")}
        </span>
      )}
      {blind ? null : record.verdict ? (
        <span className={record.verdict.pass ? "lab-pass" : "lab-fail"} title={record.verdict.note}>
          {record.verdict.pass ? "통과" : "미통과"}
        </span>
      ) : (
        <span className="lab-pending">판정 전</span>
      )}
    </span>
  );
  return (
    <div className="lab-record">
      {/* 그림은 판정 대상 자체라 접지 않는다 · 크게 보려면 눌러 연다 */}
      {record.files.length > 0 && head}
      {record.files.map((file) => {
        const url = fileUrl(`${base}/${file.path}`);
        return url ? (
          <a key={file.path} href={url} target="_blank" rel="noreferrer">
            <img src={url} alt={record.case} loading="lazy" />
          </a>
        ) : (
          <p key={file.path} className="lab-missing">
            파일 없음: {file.path}
          </p>
        );
      })}
      <details className="lab-more">
        <summary>{record.files.length > 0 ? "기록 보기" : head}</summary>
        {record.world && <p>장면 세계: {record.world}</p>}
        {record.candidates && (
          <ol className="lab-candidates">
            {record.candidates.map((c) => (
              <CandidateLine key={`${c.id ?? ""}${c.anchor}`} c={c} />
            ))}
          </ol>
        )}
        {!blind && (
          <p className="lab-muted">
            {record.visual
              ? `렌더 ${record.visual.renders} · 열람 ${record.visual.views} · 열람 뒤 수정 ${record.visual.editsAfterView}`
              : "시각 확인 기록 없음"}
            {record.model && ` · ${record.model}`}
            {record.note && ` · ${record.note}`}
          </p>
        )}
        {!blind && record.verdict?.note && <p>판정 메모: {record.verdict.note}</p>}
      </details>
    </div>
  );
}

// 연구소 비교판 · 사례(행) × 변형(열) · 기준 변형이 첫 열 (LAB-001)
export function LabBoard({ lab, fileUrl }: { lab: Lab; fileUrl: FileUrl }) {
  const [stage, setStage] = useState<"all" | keyof typeof STAGE_NAMES>("all");
  // 맹검 판정 · 변형 이름·가설을 가리고 열 순서를 섞어, 어느 변형인지 모른 채 그림만 보고 판정한다
  const [blind, setBlind] = useState(false);
  const matrix = labMatrix(lab);
  const order = blind
    ? shuffled(
        matrix.variants.map((_, i) => i),
        lab.records.length,
      )
    : matrix.variants.map((_, i) => i);
  const variants = order.map((i) => matrix.variants[i]);
  const rows = matrix.rows.map((row) => ({ ...row, cells: order.map((i) => row.cells[i]) }));
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
        {(["all", "plan", "compose", "figure"] as const).map((value) => (
          <label key={value}>
            <input type="radio" checked={stage === value} onChange={() => setStage(value)} />
            {value === "all" ? "전체" : STAGE_NAMES[value]}
          </label>
        ))}
        <label>
          <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} />
          맹검(변형 가리기)
        </label>
      </div>
      <div
        className="lab-grid"
        style={{ gridTemplateColumns: `8rem repeat(${variants.length}, minmax(18rem, 1fr))` }}
      >
        <div />
        {variants.map((v) => (
          <div key={v.id} className="lab-variant">
            {blind ? (
              <b>변형 {variants.indexOf(v) + 1}</b>
            ) : (
              <details>
                <summary>
                  <b>{v.label}</b>
                </summary>
                <p>{v.hypothesis}</p>
                {v.changes.length > 0 && (
                  <ul>
                    {v.changes.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                )}
              </details>
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
                    {!blind && (
                      <p className="lab-summary">
                        {cell.summary.trials}회 · 중앙 {minutes(cell.summary.ms)} ·{" "}
                        {tokens(cell.summary.tokens)} 토큰 · 판정 {cell.summary.passed}/
                        {cell.summary.judged}
                      </p>
                    )}
                    {cell.records.map((r) => (
                      <Record
                        key={`${r.stage}-${r.trial}`}
                        record={r}
                        fileUrl={fileUrl}
                        blind={blind}
                      />
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
