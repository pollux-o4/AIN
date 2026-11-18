import {
  formatCost,
  formatDuration,
  formatTokens,
  OUTCOME_LABEL,
} from "../../../contracts/usage-format.mjs";
import type { Usage } from "../shared/api";

// 자원 사용량: 합계 → 먼저 볼 곳 → 회차별 막대(펼치면 단계·시도) · 큰 것부터
const byTime = <T extends { ms: number }>(items: T[]) => [...items].sort((a, b) => b.ms - a.ms);

function Bar({ ms, max }: { ms: number; max: number }) {
  return (
    <span className="usage-bar" aria-hidden="true">
      <span style={{ width: `${max ? Math.max(2, (ms / max) * 100) : 0}%` }} />
    </span>
  );
}

export function UsageSummary({ usage }: { usage: Usage }) {
  if (!usage.calls) return null;
  const revisionMax = Math.max(...usage.revisions.map((r) => r.ms));
  return (
    <section className="usage" aria-label="자원 사용량">
      <h3>자원 사용량</h3>
      <p>{formatCost(usage)}</p>
      <h4>먼저 볼 곳</h4>
      <ol>
        {usage.hotspots.map((h) => (
          <li key={`${h.label}-${h.ms}`} data-outcome={h.outcome}>
            {h.label} · {formatDuration(h.ms)} · {formatTokens(h.tokens)} ·{" "}
            {OUTCOME_LABEL[h.outcome]}
          </li>
        ))}
      </ol>
      <ul className="usage-tree">
        {byTime(usage.revisions).map((r) => {
          const stageMax = Math.max(...r.stages.map((s) => s.ms));
          return (
            <li key={r.revision}>
              <details>
                <summary>
                  <Bar ms={r.ms} max={revisionMax} /> 초안 {r.revision} · {formatCost(r)}
                </summary>
                <ul>
                  {byTime(r.stages).map((s) => (
                    <li key={s.stage}>
                      <Bar ms={s.ms} max={stageMax} /> {s.name} · {formatCost(s)}
                      {s.attempts.length > 1 && (
                        <ul>
                          {s.attempts.map((a, i) => (
                            // biome-ignore lint/suspicious/noArrayIndexKey: 시도는 순서만 식별자
                            <li key={i} data-outcome={a.outcome}>
                              {a.label.split(" · ").at(-1)} · {formatDuration(a.ms)}
                              {a.chars !== null && ` · ${a.chars.toLocaleString("en-US")}자`} ·{" "}
                              {OUTCOME_LABEL[a.outcome]}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
