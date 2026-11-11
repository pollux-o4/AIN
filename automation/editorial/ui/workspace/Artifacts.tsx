import type { Run } from "../shared/api";
import { withOccurrenceKeys } from "../shared/listKeys";
import { StageOutput } from "../shared/StageOutput";

export function Artifacts({ run }: { run: Run }) {
  if (!run.artifacts.length) return null;
  return (
    <section id="artifacts" aria-labelledby="artifacts-title">
      <h2 id="artifacts-title">단계별 결과</h2>
      {withOccurrenceKeys(run.artifacts).map(({ value: artifact, key }) => (
        <details key={key} data-stage={artifact.stage} data-revision={artifact.revision}>
          <summary>
            {artifact.name} · {artifact.revision === run.revision ? "현재" : "이전"} 회차{" "}
            {artifact.revision}
          </summary>
          {artifact.reusedFromRevision !== undefined && (
            <p className="hint">이전 회차 {artifact.reusedFromRevision}의 결과를 재사용했습니다.</p>
          )}
          <StageOutput stage={artifact.stage} output={artifact.output} />
        </details>
      ))}
    </section>
  );
}
