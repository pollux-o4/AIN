// 검증: ADR-0009 구간별 초고
import assert from "node:assert/strict";
import test from "node:test";
import { nextAction, previousPart, readerLength, transition } from "../domain/index.mjs";
import { diagnoseFor } from "./requirement-fixtures.mjs";
import { STORY } from "./story-card.mjs";

const base = {
  diagnose: {
    purpose: "p",
    audience: "a",
    sectionModes: ["explain"],
    preserveVoice: "v",
    strategy: "s",
  },
  topic: { problem: "p", scope: "s" },
  audience: { reader: "r", intent: "i" },
  value: { outcome: "o", preserve: ["p"] },
  research: { evidence: [], uncertainties: ["u"] },
  outline: {
    sections: [
      { title: "도입", mode: "explain", keyPoint: "k", budget: 1000, ...STORY },
      { title: "본론", mode: "explain", keyPoint: "k", budget: 2000, ...STORY },
      { title: "정리", mode: "explain", keyPoint: "k", budget: 600, ...STORY },
    ],
    rationale: "r",
  },
  review: { findings: [], preservationCheck: "ok" },
};
let seq = 0;
const step = (state, type, extra = {}) =>
  transition(state, {
    id: `s${seq++}`,
    actor: ["start", "retry"].includes(type) ? "user" : "adapter",
    type,
    expectedVersion: state?.version,
    ...extra,
  }).state;
const complete = (state, output) =>
  step(state, "complete", {
    stage: state.stage,
    revision: state.revision,
    output,
    ...(nextAction(state).section ? { section: nextAction(state).section.index } : {}),
  });

// 진단은 글감 문장의 분량 요구를 요구사항 목록으로 옮긴다(AI 대역)
const fixture = (s) =>
  s.stage === "diagnose" ? diagnoseFor(s.idea, base.diagnose) : base[s.stage];

function toDraft(idea, outline = base.outline) {
  let s = step(null, "start", { articleId: "x", idea });
  while (s.stage !== "draft")
    s = complete(
      s,
      s.stage === "outline"
        ? outline
        : s.stage === "diagnose"
          ? diagnoseFor(idea, base.diagnose)
          : base[s.stage],
    );
  return s;
}
// 첫 구간(도입)은 글 제목 줄로 시작 · 제목 줄을 넣어도 구간 글자 수는 같게
const LEAD = "# 제목\n";
const part = (n, label) => {
  const lead = label === "도입" ? LEAD : "";
  return { text: `${lead}## ${label}\n${"가".repeat(n - lead.length)}`, changeSummary: label };
};

test("분량 예산이 있으면 구간마다 따로 쓰고 순서대로 합친다", () => {
  let s = toDraft("설명 · 3600자 안팎");
  assert.deepEqual([nextAction(s).section.index, nextAction(s).section.budget], [0, 1000]);
  s = complete(s, part(900, "도입"));
  assert.equal(s.stage, "draft");
  s = complete(s, part(1900, "본론"));
  assert.equal(nextAction(s).section.budget, 600);
  s = complete(s, part(600, "정리"));
  assert.equal(s.stage, "review");
  assert.match(s.artifacts.draft.output.text, /^# 제목\n## 도입[\s\S]+## 본론[\s\S]+## 정리/);
});

test("구간이 예산을 크게 넘으면 그 구간만 다시 쓰고, 상한 후에도 넘으면 실패로 멈춘다", () => {
  let s = toDraft("설명 · 3600자 안팎");
  s = complete(s, part(2000, "도입"));
  assert.equal(nextAction(s).section.index, 0);
  assert.match(nextAction(s).section.retryNote, /직전 작성 2006자 · 예산 1000자/);
  assert.equal([...nextAction(s).section.rejected].length, 2006, "거부된 원고를 줄이도록 전달");
  s = complete(s, part(1900, "도입"));
  assert.equal(nextAction(s).section.index, 0, "두 번째 초과도 수용하지 않음");
  s = complete(s, part(1850, "도입"));
  assert.equal(nextAction(s).section.index, 0, "세 번째 초과도 수용하지 않음");
  s = complete(s, part(1800, "도입"));
  assert.equal(s.status, "failed", "상한 소진 후 초과 구간은 초고로 넘기지 않음");
  assert.match(s.error, /"도입" 구간이 3회 다시 써도 한도 1250자를 넘음/);
  assert.equal(s.artifacts.draft, undefined);
  s = step(s, "retry");
  assert.equal(s.status, "waiting_ai");
  assert.match(
    nextAction(s).section.retryNote,
    /직전 작성 1806자/,
    "이어가기는 같은 지적으로 재개",
  );
  s = complete(s, part(1100, "도입"));
  assert.equal(nextAction(s).section.index, 1);
  assert.throws(
    () =>
      step(s, "complete", {
        stage: "draft",
        revision: s.revision,
        output: part(10, "x"),
        section: 0,
      }),
    /stale draft section/,
  );
});

test("분량 요구가 있으면 구성 예산을 검사: 누락·합계 위반은 1회 다시, 반복되면 실패", () => {
  let s = step(null, "start", { articleId: "o", idea: "설명 · 3600자 안팎" });
  while (s.stage !== "outline") s = complete(s, fixture(s));
  const unbudgeted = { sections: ["도입", "본론", "정리"], rationale: "r" };
  s = complete(s, unbudgeted);
  assert.equal(s.stage, "outline");
  assert.match(s.retry.note, /모든 구간에 budget/);
  const over = {
    sections: [1, 2, 3].map((n) => ({
      title: `${n}`,
      mode: "explain",
      keyPoint: "k",
      budget: 1650,
      ...STORY,
    })),
    rationale: "r",
  };
  s = complete(s, over);
  assert.equal(s.status, "failed");
  assert.match(s.error, /budget 합계 4950자가 요구 3240~3960자 밖/);
  s = step(s, "retry");
  s = complete(s, base.outline);
  assert.equal(s.stage, "draft");
  assert.equal(s.retry, undefined);
});

test("분량 요구도 구간 예산도 없으면 기존처럼 한 번에 작성", () => {
  const s = toDraft("설명", { sections: ["도입", "본론"], rationale: "r" });
  assert.equal(nextAction(s).section, undefined);
});

test("원고는 글 제목 줄로 시작: 빠지면 반려 원고와 사유를 주고 다시, 구간별이면 첫 구간만 검사", () => {
  const titled = { sections: ["도입", "본론"], rationale: "r", title: "줄 세우기 입문" };
  let s = toDraft("설명", titled);
  const missing = "## 도입\n본문";
  s = complete(s, { text: missing, changeSummary: "초고" });
  assert.equal(s.stage, "draft");
  assert.match(nextAction(s).retryNote, /'# 줄 세우기 입문' 줄로 시작/);
  assert.equal(nextAction(s).rejected, missing, "반려 원고를 고치도록 전달");
  s = complete(s, { text: "# 줄 세우기 입문\n\n장면\n\n## 도입\n본문", changeSummary: "초고" });
  assert.equal(s.stage, "review");
  assert.equal(s.retry, undefined);
  // 구간별: 첫 구간만 제목 줄을 갖는다
  s = toDraft("설명 · 3600자 안팎");
  s = complete(s, { text: "## 도입\n본문", changeSummary: "도입" });
  assert.match(nextAction(s).section.retryNote, /'# 제목' 줄로 시작/);
});

test("분량은 독자에게 보이는 글자로 센다: 마크다운 링크 주소 제외", () => {
  assert.equal(
    readerLength("[공식 문서](https://example.com/a/very/long/path) 참고"),
    "[공식 문서] 참고".length,
  );
  assert.equal(readerLength("주소 https://example.com"), "주소 https://example.com".length);
});

test("ADR-0013 구간 카드: 빈 항목은 1회 다시, 따라 하기·이전 문자열 구간은 검사하지 않는다", () => {
  let s = step(null, "start", { articleId: "card", idea: "설명" });
  while (s.stage !== "outline") s = complete(s, base[s.stage]);
  const card = (extra) => ({ title: "개념", mode: "explain", keyPoint: "k", ...extra });
  const { underline: _underline, ...partial } = STORY;
  s = complete(s, {
    sections: [card(partial), card({ ...STORY, cases: ["a", "b", "c", "d"] })],
    rationale: "r",
  });
  assert.equal(s.stage, "outline");
  assert.match(s.retry.note, /1번 "개념": underline \/ 2번 "개념": cases는 3개 이하/);
  s = complete(s, {
    sections: [card(STORY), { title: "순서", mode: "procedure", keyPoint: "k" }, "옛 구간"],
    rationale: "r",
  });
  assert.equal(s.stage, "draft");
  assert.equal(s.retry, undefined);
});

test("ADR-0013 지면: 카드 구간 예산이 항목을 담지 못하면 거부, 2구간도 불가능한 짧은 글은 검사하지 않는다", () => {
  const card = (budget) => ({
    title: `${budget}`,
    mode: "narrate",
    keyPoint: "k",
    budget,
    ...STORY,
  });
  const outlined = (idea, budgets) => {
    let s = step(null, "start", { articleId: "space", idea });
    while (s.stage !== "outline") s = complete(s, fixture(s));
    return complete(s, { sections: budgets.map(card), rationale: "r" });
  };
  // 실제 모델 실측: 600~900자에 3구간(250·260·240) → 첫 구간이 도입부와 카드를 담지 못함
  const tight = outlined("수필 600~900자", [250, 260, 240]);
  assert.equal(tight.stage, "outline");
  assert.match(tight.retry.note, /1번 250자 < 420자.*구간 수를 줄여/);
  assert.equal(outlined("수필 600~900자", [480, 380]).stage, "draft");
  assert.equal(outlined("수필 300~400자", [200, 180]).stage, "draft");
});

test("구간 한도는 전체 분량과 묶인다: 앞 구간이 쓴 만큼 뒤 한도가 줄고, 마지막 구간은 전체 하한을 채운다", () => {
  // 요구 3240~3960자 · 예산 1000·2000·600
  let s = toDraft("설명 · 3600자 안팎");
  assert.equal(nextAction(s).section.limit, 1250, "여유가 있으면 예산의 125%");
  s = complete(s, part(1200, "도입"));
  // 3960 - (1206 + 2) - (600 + 2) = 2150 · 구간별 125%(2500)를 그대로 주면 합계가 상한을 넘는다
  assert.equal(nextAction(s).section.limit, 2150);
  s = complete(s, part(2200, "본론"));
  assert.match(nextAction(s).section.retryNote, /한도 2150자/);
  s = complete(s, part(1400, "본론"));
  // 마지막 구간: 상한 3960 - 1208 - 1408 = 1344 → 125%(750)가 더 작다 · 하한 3240 - 2616 = 624
  assert.deepEqual([nextAction(s).section.limit, nextAction(s).section.floor], [750, 624]);
  s = complete(s, part(300, "정리"));
  assert.match(nextAction(s).section.retryNote, /624자 이상/);
  s = complete(s, part(640, "정리"));
  assert.equal(s.stage, "review");
  const total = readerLength(s.artifacts.draft.output.text);
  assert.ok(total >= 3240 && total <= 3960, `전체 ${total}자가 요구 범위 안`);
});

test("기준본 찾기: 도입은 첫 구간에 붙고, 첫 구간에 소제목이 없던 이전 초고도 읽는다", () => {
  const current = "# 제목\n\n도입\n\n## 하나\n가\n\n## 둘\n나";
  assert.equal(previousPart(current, 0, 2), "# 제목\n\n도입\n\n## 하나\n가");
  assert.equal(previousPart(current, 1, 2), "## 둘\n나");
  const legacy = "# 제목\n\n도입과 첫 구간\n\n## 둘\n나";
  assert.equal(previousPart(legacy, 0, 2), "# 제목\n\n도입과 첫 구간");
  assert.equal(previousPart(current, 0, 4), undefined, "구간 수가 다르면 기준본 없음");
});

test("ADR-0013 한 줄 항목은 글자 수 상한을 넘으면 거부한다(뜻은 보지 않고 세기만)", () => {
  let s = step(null, "start", { articleId: "slot", idea: "설명" });
  while (s.stage !== "outline") s = complete(s, base[s.stage]);
  const long =
    "주 비밀번호는 잊어도 아무 열쇠나 꽂아 대신 열 수 있는 열쇠가 아니라 잃어버리면 되찾기 어려운 유일한 열쇠입니다.";
  const card = { title: "앞", mode: "explain", keyPoint: "k", ...STORY };
  s = complete(s, {
    sections: [
      { ...card, underline: long },
      { ...card, title: "뒤" },
    ],
    rationale: "r",
  });
  assert.equal(s.stage, "outline");
  assert.match(s.retry.note, /1번 "앞": underline \d+자 → 45자 이내/);
  s = complete(s, { sections: [card, { ...card, title: "뒤" }], rationale: "r" });
  assert.equal(s.stage, "draft");
});

test("ADR-0020 글 제목도 규칙표 상한을 넘으면 구성을 반려한다(세기만)", () => {
  let s = step(null, "start", { articleId: "title", idea: "설명" });
  while (s.stage !== "outline") s = complete(s, base[s.stage]);
  const card = { title: "앞", mode: "explain", keyPoint: "k", ...STORY };
  const outline = (title) => ({
    title,
    sections: [card, { ...card, title: "뒤" }],
    rationale: "r",
  });
  s = complete(
    s,
    outline("알고리즘이 무엇이고 왜 중요하며 어떻게 나뉘는지 한 번에 알 수 있습니다"),
  );
  assert.equal(s.stage, "outline");
  assert.match(s.retry.note, /글 제목을 고친다 → title \d+자 → 25자 이내/);
  s = complete(s, outline("알고리즘, 뜻부터 갈래까지"));
  assert.equal(s.stage, "draft");
});
