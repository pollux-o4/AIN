// usage 보고서 → 터미널 트리 · 큰 것부터 · 막대는 같은 수준 안 최댓값 대비
import {
  formatCost as cost,
  formatDuration as duration,
  OUTCOME_LABEL as OUTCOME,
  formatTokens as tokens,
} from "../contracts/usage-format.mjs";

const WIDTH = 20;
const bar = (ms, max) => "█".repeat(max ? Math.max(1, Math.round((ms / max) * WIDTH)) : 0);
const byTime = (items) => [...items].sort((a, b) => b.ms - a.ms);

export function renderUsage(usage) {
  if (!usage.calls) return "AI 호출 기록이 없습니다.";
  const lines = [`글 전체  ${cost(usage)}`, "", "먼저 볼 곳 (시간 순)"];
  for (const [i, h] of usage.hotspots.entries())
    lines.push(
      `  ${i + 1}. ${h.label}  ${duration(h.ms)} · ${tokens(h.tokens)} · ${OUTCOME[h.outcome]}`,
    );
  lines.push("", "회차 → 단계 → 시도");
  const revMax = Math.max(...usage.revisions.map((r) => r.ms));
  for (const r of byTime(usage.revisions)) {
    lines.push(`  ${bar(r.ms, revMax).padEnd(WIDTH)} 회차 ${r.revision}  ${cost(r)}`);
    const stageMax = Math.max(...r.stages.map((s) => s.ms));
    for (const s of byTime(r.stages)) {
      lines.push(`    ${bar(s.ms, stageMax).padEnd(WIDTH)} ${s.name}  ${cost(s)}`);
      if (s.attempts.length < 2) continue;
      for (const a of s.attempts)
        lines.push(
          `        ${a.label.split(" · ").at(-1)}  ${duration(a.ms)}${a.chars === null ? "" : ` · ${a.chars.toLocaleString("en-US")}자`} · ${OUTCOME[a.outcome]}`,
        );
    }
  }
  return lines.join("\n");
}
