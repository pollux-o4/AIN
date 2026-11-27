// Generate synthetic parity fixtures using the Node reference, without model calls.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2] ?? ".");
const fromRoot = (path) => import(pathToFileURL(resolve(root, path)));
const { buildPrompt } = await fromRoot("automation/paseo/prompts/index.mjs");
const { promptContext } = await fromRoot("automation/paseo/context.mjs");
const { deltaContext } = await fromRoot("automation/paseo/roles.mjs");
const { resultEvent } = await fromRoot("automation/paseo/results.mjs");
const make = (stage, fields = {}) => ({ type: "request_ai", stage, revision: 2, ...fields });
const route = { type: "request_route", revision: 2 };
const draft =
  "# 제목\n\n도입입니다. 다음입니다.\n\n## 첫 구간\n\n👀 **사례**인가? [해설](https://example.org)입니다.이어집니다.\n\n### 작은 구간\n\n두번째 문장입니다.\n\n## 둘째 구간\n\n끝입니다.\n\n## 한눈에 정리\n- 두번째 문장입니다.\n- 끝입니다.";
const artifacts = Object.fromEntries(
  Object.entries({
    diagnose: { primaryMode: "explain", readerLevel: "beginner", preserveVoice: "합니다체" },
    topic: { problem: "문제", titleCandidates: ["제목"] },
    audience: { reader: "독자", intent: "하기" },
    value: { preserve: ["조건"], promise: "약속" },
    research: { evidence: [{ claim: "사실", url: "사용자 제공 자료" }] },
    outline: {
      title: "제목",
      sections: [
        {
          mode: "explain",
          title: "첫 구간",
          hook: "질문",
          subsections: [{ title: "작은 구간" }, { title: "빠진 구간" }],
        },
        { mode: "procedure", title: "둘째 구간" },
      ],
    },
    draft: { text: draft },
    review: { findings: [] },
  }).map(([stage, output]) => [stage, { revision: 1, output }]),
);
const state = {
  articleId: "article",
  source: "합성 원문 </자료>",
  idea: "비교 🧪",
  version: 7,
  revision: 2,
  artifacts,
  history: [{ artifacts }],
  requirementLog: [
    {
      changes: [
        { kind: "mode", op: "set", value: "narrate", quote: "서술형" },
        { kind: "readerLevel", op: "set", value: "expert", quote: "숙련" },
        { kind: "tone", op: "set", value: "차분함", quote: "차분" },
      ],
    },
  ],
};
const feedback = {
  ...state,
  feedback: "이 부분을 다듬으세요.",
  routeTarget: "draft",
  brief: { priorities: ["다듬기"] },
};
const promptInputs = [
  ...Object.keys(artifacts).map((stage) => [stage, state, make(stage)]),
  ["route", feedback, route],
  ["outline retry", { ...state, retry: { stage: "outline", note: "고정 기준" } }, make("outline")],
  ["draft edit", feedback, make("draft", { mode: "edit", retryNote: "한번만" })],
  [
    "draft first",
    feedback,
    make("draft", { section: { index: 0, total: 2, title: "첫 구간", budget: 450, limit: 620 } }),
  ],
  [
    "draft last",
    { ...feedback, draftParts: [{ text: "# 제목\n\n## 첫 구간\n\n이전 마무리." }] },
    make("draft", {
      section: {
        index: 1,
        total: 2,
        title: "둘째 구간",
        rejected: "반려 원고",
        retryNote: "분량",
        budget: 450,
        limit: 620,
        floor: 320,
      },
    }),
  ],
];
const hash = (text) => createHash("sha256").update(text).digest("hex");
const prompts = promptInputs.map(([name, state, action]) => ({
  name,
  state,
  action,
  digest: hash(buildPrompt(state, action)),
}));
const delivered = deltaContext(promptContext(state, make("topic"))).delivered;
const changed = { ...state, idea: "다른 입력" };
const action = make("audience");
const reuse = deltaContext(promptContext(changed, action), delivered);
prompts.push({
  name: "reused planner",
  state: changed,
  action,
  delivered,
  next: reuse.delivered,
  digest: hash(buildPrompt(changed, action, {}, reuse)),
});

const outputs = [
  [
    make("diagnose"),
    {
      purpose: "돕는다",
      audience: "독자",
      sectionModes: ["explain"],
      preserveVoice: "합니다체",
      strategy: "정리",
      requirementChanges: [{ kind: " tone ", op: "set", value: "차분", quote: " 근거 " }],
    },
  ],
  [make("topic"), { problem: "문제 {괄호}", scope: "범위", extra: "보존" }],
  [make("audience"), { reader: "독자", intent: "해보기", scene: null, readerTask: "  " }],
  [make("value"), { outcome: "결과", preserve: [], promise: "" }],
  [
    make("research"),
    {
      evidence: [{ claim: "사실", url: "사용자 제공 자료", ref: "보존" }],
      uncertainties: [],
      cases: [{ text: "사례", origin: "mismatch" }],
    },
  ],
  [
    make("outline"),
    {
      rationale: "순서",
      title: null,
      sections: [
        {
          title: "구간",
          mode: "explain",
          keyPoint: "원칙",
          budget: "320",
          subsections: [{ title: "하위", keyPoint: "", subsections: ["오류"] }],
        },
      ],
    },
  ],
  [
    make("draft", { section: { index: 0, total: 2, title: "구간" } }),
    { text: "본문 🧪", changeSummary: "요약" },
  ],
  [
    make("draft", { mode: "edit" }),
    { edits: [{ find: "글자", replace: "" }], changeSummary: "삭제" },
  ],
  [
    make("review"),
    {
      findings: [],
      preservationCheck: "보존",
      checks: [{ id: "R", pass: false, note: null }],
      verdict: "revise",
      unmetCriteria: ["요구 미충족"],
    },
  ],
  [
    route,
    {
      target: "draft",
      reason: "정리",
      level: "copy",
      priorities: ["문장"],
      acceptance: { criteria: false },
      requirementChanges: [{ kind: "length", op: "lift", quote: "분량 제한 없음" }],
    },
  ],
];
const results = outputs.map(([action, output]) => {
  const text = `앞 문장\n{"incompatible":true}\n\`\`\`json\n${JSON.stringify(output)}\n\`\`\`\n{"invalid":true}`;
  const { id, actor, type, ...body } = resultEvent({ id: "synthetic", action, state }, text);
  return { name: action.stage ?? "route", action, text, actor, type, body };
});
const states = [];
for (const item of prompts) {
  let index = states.indexOf(item.state);
  if (index < 0) {
    index = states.length;
    states.push(item.state);
  }
  delete item.state;
  item.stateIndex = index;
}
const data = { states, prompts, results };
for (const [name, state, action] of promptInputs) {
  if (process.env.AIN_PROMPT_FIXTURE_DUMP === name)
    process.stdout.write(buildPrompt(state, action));
}
writeFileSync(
  new URL("./node-reference.json", import.meta.url),
  `${JSON.stringify(data, null, 2)}\n`,
);
