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
    changes: [],
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
    canApproveDesign: false,
    canReviseFigures: false,
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

// 시각자료 단계 합성 데이터 · 후보 자리(figure-slot)를 본문 문단 뒤에 둔다
const slot = (id: string) => `<div class="figure-slot" data-candidate="${id}"></div>`;
export const figureHtml = html
  .replace("대표적입니다.</p>", `대표적입니다.</p>${slot("f1")}`)
  .replace("가릅니다.</blockquote>", `가릅니다.</blockquote>${slot("f2")}`)
  .replace("</table>", `</table>${slot("f3")}`);
const candidates: Figure["candidates"] = [
  {
    id: "f1",
    anchor: "메인프레임, 클라이언트-서버, SOA, 마이크로서비스, 모듈러 모놀리스가 대표적입니다.",
    claim: "다섯 구조가 시간순으로 등장했다.",
    reason: "종류를 처음 소개하는 지점이다.",
    analogy: null,
    scene: "연표 위 다섯 구조",
    mapping: [],
    kind: "flow",
    motifs: [],
    direction: null,
    // 목록으로 충분한 자리 · 고르지 않는 사례
    without: "다섯 이름의 순서는 본문 목록으로도 읽힌다.",
    route: "svg",
    routeBy: "default",
    section: "어떤 아키텍처가 있나",
  },
  {
    id: "f2",
    anchor: "요약: 규모가 아니라 팀 구조와 변경 빈도가 선택을 가릅니다.",
    claim: "팀 구조와 변경 빈도가 선택 기준이다.",
    reason: "글의 핵심 주장이다.",
    analogy: "갈림길",
    scene: "팀 크기·변경 빈도 두 축의 갈림길",
    mapping: [{ element: "갈림길", concept: "선택 기준" }],
    kind: "scene",
    motifs: ["주문 상자"],
    direction: null,
    without: "두 기준이 동시에 선택을 가른다는 감각을 놓친다.",
    route: "image",
    routeBy: "default",
    section: "어떤 아키텍처가 있나",
  },
  {
    id: "f3",
    anchor: "운영 비용",
    claim: "배포 단위가 늘면 운영 비용이 오른다.",
    reason: "표의 차이를 수량으로 보인다.",
    analogy: null,
    scene: "배포 단위 수와 운영 비용 막대",
    mapping: [{ element: "막대 높이", concept: "운영 비용" }],
    kind: "chart",
    motifs: ["주문 상자"],
    direction: null,
    without: "운영 비용이 배포 단위 수에 따라 얼마나 오르는지 크기를 놓친다.",
    route: "svg",
    routeBy: "default",
    section: "무엇이 다른가",
  },
];
type Figure = NonNullable<Run["figure"]>;
export function makeFigure(over: Partial<Figure> = {}): Figure {
  return {
    phase: "choose",
    world: null,
    feedback: null,
    recompose: [],
    note: null,
    candidates,
    style: { accent: "주황 #E8743B", base: "회색 선 1.5px", labels: "12px 굵게" },
    motifs: [{ name: "주문 상자", look: "갈색 상자에 영수증 한 장" }],
    selected: [],
    routesAvailable: ["svg"],
    coverage: { units: 3, withFigure: 2, candidates: 3, gap: null },
    current: null,
    items: [],
    ...over,
  };
}
