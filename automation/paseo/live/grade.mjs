// 실제 모델 결과의 채점 · 같은 글감을 여러 번 돌려 통과율로 멱등성을 본다
// 코드 기준: 세거나 글자 그대로 대조한 것(분량·카드 항목·소제목·회차) · 글의 질(말투·과장·장면·풀이)은 검토(LLM)의 판정과 점검표를 그대로 집계
// 입력은 contract-e2e가 남기는 report.quality(원문 없음) · 새 기준은 GRADERS에 항목 하나를 더한다
// hard: 하나라도 어기면 그 실행은 불합격 · soft: 추세만 본다(점검표 한 항목의 미통과는 판정을 뒤집지 않음)
const empty = (list) => Array.isArray(list) && list.length === 0;

// basis · JUDGE-001: count(세기) · exact(글자 대조) · process(실행 기록) · review(검토 LLM의 판정을 그대로 집계)
// 글의 뜻을 코드가 판정하는 기준은 둘 수 없다 · tests/judge-001이 basis를 검사한다
/** @type {{ id: string, basis: "count"|"exact"|"process"|"review", hard: boolean, ask: string, pass: (q: any) => boolean }[]} */
export const GRADERS = [
  {
    id: "length",
    basis: "count",
    hard: true,
    ask: "분량이 요구 범위 안인가",
    pass: (q) => {
      const range = q.requirements?.length;
      return (
        !range || (q.characters >= range.min && (range.max === null || q.characters <= range.max))
      );
    },
  },
  {
    id: "first_pass",
    basis: "process",
    hard: true,
    ask: "자동 재작성 없이 첫 회차에 끝났는가",
    pass: (q) => q.autoCorrections === 0,
  },
  {
    id: "cards",
    basis: "count",
    hard: true,
    ask: "구간 카드 구간마다 항목이 채워졌는가",
    pass: (q) => q.storyCards === q.cardSections,
  },
  {
    id: "transfer",
    basis: "exact",
    hard: true,
    ask: "제목이 구성과 같고 끝 정리 목록이 본문 마무리 문장을 그대로 모았는가",
    pass: (q) => {
      const t = q.metrics.cardTransfer;
      return (
        !t ||
        (t.titleMatches !== false &&
          empty(t.summaryNotInBody) &&
          t.summaryCount.expected === t.summaryCount.actual)
      );
    },
  },
  {
    id: "headings",
    basis: "exact",
    hard: true,
    ask: "모든 구간이 구성의 소제목으로 시작하는가",
    pass: (q) => empty(q.metrics.missingHeadings ?? []),
  },
  {
    id: "verdict",
    basis: "review",
    hard: true,
    ask: "검토 판정이 pass인가",
    pass: (q) => q.verdict === "pass",
  },
  {
    id: "checks",
    basis: "review",
    hard: false,
    ask: "검토 점검표(S1~S10)를 모두 통과했는가",
    pass: (q) => q.checks > 0 && empty(q.failedChecks),
  },
];

/** @param {any} quality report.quality */
export function grade(quality) {
  const results = Object.fromEntries(GRADERS.map((g) => [g.id, g.pass(quality)]));
  return {
    results,
    passed: GRADERS.filter((g) => g.hard).every((g) => results[g.id]),
  };
}

const spread = (values) => {
  const sorted = values.filter((v) => typeof v === "number").sort((a, b) => a - b);
  return sorted.length
    ? { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1) }
    : null;
};

/**
 * 같은 글감의 반복 실행 묶음 → 기준별 통과율과 비용 분포
 * @param {{ quality?: any, calls?: number, durationMs?: number, outputTokens?: number, failure?: string }[]} trials
 */
export function summarize(trials) {
  const graded = trials.filter((t) => t.quality).map((t) => ({ ...t, ...grade(t.quality) }));
  const rate = (count) => (trials.length ? Math.round((count / trials.length) * 100) / 100 : 0);
  return {
    trials: trials.length,
    completed: graded.length,
    // 실행 실패(멈춤·시간 초과)도 불합격으로 센다
    passRate: rate(graded.filter((t) => t.passed).length),
    consistent:
      trials.length > 0 && graded.length === trials.length && graded.every((t) => t.passed),
    graders: Object.fromEntries(
      GRADERS.map((g) => [g.id, rate(graded.filter((t) => t.results[g.id]).length)]),
    ),
    // 점검표 항목별 미통과 횟수 · 같은 항목이 되풀이되면 그 규칙의 프롬프트를 고칠 신호
    failedChecks: Object.fromEntries(
      [...new Set(graded.flatMap((t) => t.quality.failedChecks))]
        .sort()
        .map((id) => [id, graded.filter((t) => t.quality.failedChecks.includes(id)).length]),
    ),
    calls: spread(graded.map((t) => t.calls)),
    durationSec: spread(graded.map((t) => Math.round(t.durationMs / 1000))),
    outputTokens: spread(graded.map((t) => t.outputTokens)),
    characters: spread(graded.map((t) => t.quality.characters)),
    failures: trials.filter((t) => t.failure).map((t) => t.failure),
  };
}
