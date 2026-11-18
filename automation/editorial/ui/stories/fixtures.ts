import type { RecentRun, Run } from "../shared/api";

// Storybook 전용 합성 데이터 · 실제 작업·AI 결과 아님
const NOW = Date.UTC(2026, 10, 12, 3, 0);
const stages = [
  "진단",
  "주제 정리",
  "독자 정리",
  "핵심 정리",
  "근거 정리",
  "구성",
  "초고 작성",
  "검토",
];
type Step = Run["monitor"]["pipeline"][number]["status"];

function pipeline(activeAt: number, tail: Step = "active") {
  return stages.map((name, i) => ({
    stage: `s${i}`,
    name,
    status: (i < activeAt ? "done" : i === activeAt ? tail : "pending") as Step,
    startedAt: i <= activeAt ? NOW - (stages.length - i) * 60000 : null,
    completedAt: i < activeAt ? NOW - (stages.length - i - 1) * 60000 : null,
  }));
}
const html = `<p>소프트웨어 아키텍처는 구성 요소 사이의 관계와 동작 원리를 정하는 설계 구조입니다. 이 글은 쇼핑몰(주문·결제·배송)을 예로 들어 아키텍처별 병목 해결 방식과 운영 비용을 비교합니다.</p>
<h2>1. 어떤 아키텍처가 있나</h2><p>메인프레임, 클라이언트-서버, SOA, 마이크로서비스, 모듈러 모놀리스가 대표적입니다.</p>
<blockquote>요약: 규모가 아니라 팀 구조와 변경 빈도가 선택을 가릅니다.</blockquote>
<h2>2. 무엇이 다른가</h2><table><tr><th>구조</th><th>배포 단위</th><th>운영 비용</th></tr><tr><td>모놀리스</td><td>하나</td><td>낮음</td></tr><tr><td>마이크로서비스</td><td>서비스별</td><td>높음</td></tr></table>`;

export function makeRun(
  over: Partial<Run> & { status: string; activeAt?: number; tail?: Step } = {
    status: "awaiting_user",
  },
): Run {
  const { activeAt = 8, tail = "active", ...rest } = over;
  const done = activeAt >= stages.length;
  return {
    id: "00000000-0000-4000-8000-000000000001",
    version: 3,
    revision: 2,
    idea: "아키텍처의 역사: 종류, 차이, 역사의 이유, 언제 어떻게 쓰나",
    title: "아키텍처의 역사: 무엇이 있고, 왜 그렇게 되었고, 언제 쓰나",
    issue: null,
    text: done ? "본문" : "",
    textRevision: done ? 2 : null,
    findings: done
      ? [
          "2절 표의 운영 비용은 근거 출처가 없습니다.",
          "결론에서 모듈러 모놀리스 예시가 반복됩니다.",
        ]
      : [],
    unmetRequirements: [],
    brief: null,
    previous: [],
    canDownload: done,
    canFeedback: done,
    needsCompletion: false,
    completionReason: null,
    canCompleteRequirements: false,
    canSatisfy: done,
    canAuthorizePublication: false,
    canApproveBrief: false,
    figure: null,
    canRequestFigures: false,
    canSelectFigures: false,
    canConfirmFigures: false,
    canDiscardFigures: false,
    archived: false,
    design: {
      mode: "explain",
      modeBy: "ai",
      readerLevel: "intermediate",
      levelBy: "user",
      sections: [
        { title: "어떤 아키텍처가 있나", mode: "explain" },
        { title: "왜 이렇게 변해 왔나", mode: "narrate" },
        { title: "언제 무엇을 쓰나", mode: "argue" },
      ],
    } as Run["design"],
    artifacts: [],
    model: "fixture-model",
    callsUsed: 9,
    maxCalls: 30,
    appliedOperations: [],
    html: done ? html : "",
    executionLinks: [],
    monitor: {
      kind: done ? "ready" : "working",
      label: done ? "초안 준비됨" : "AI 작업 중",
      now: NOW,
      lastConfirmedAt: NOW - 4000,
      executionId: null,
      canPause: !done,
      canResume: false,
      resumeLabel: "이어서 진행",
      needsAiAttention: false,
      events: [],
      pipeline: pipeline(activeAt, tail),
    },
    ...rest,
  } as Run;
}
export const recent: RecentRun[] = [
  {
    id: "a1",
    title: "아키텍처의 역사: 무엇이 있고, 왜 그렇게 되었고, 언제 쓰나",
    revision: 2,
    status: "awaiting_user",
    label: "초안 준비됨",
    updatedAt: Date.now() - 5 * 60000,
  },
  {
    id: "a2",
    title: "주문 시스템을 이벤트 기반으로 옮긴 이유",
    revision: 1,
    status: "waiting_ai",
    label: "AI 작업 중",
    updatedAt: Date.now() - 30 * 60000,
  },
  {
    id: "a3",
    title: "팀이 작을 때 모듈러 모놀리스를 고르는 법",
    revision: 3,
    status: "failed",
    label: "멈춤",
    updatedAt: Date.now() - 26 * 3600000,
  },
];
