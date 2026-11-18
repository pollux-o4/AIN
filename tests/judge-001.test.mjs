// 검증: JUDGE-001 글 품질 판정 경계
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GRADERS } from "../automation/paseo/live/grade.mjs";
import { draftMetrics, METRIC_BASIS } from "../automation/paseo/metrics.mjs";

// 코드가 품질을 판정하는 곳 · 판정 코드가 늘면 여기에 더한다
const JUDGING_CODE = [
  "automation/paseo/metrics.mjs",
  "automation/paseo/live/grade.mjs",
  "automation/editorial/domain/sections.mjs",
];
// 형식 토큰화로 허용한 한글 정규식 · 뜻 판정이 아닌 이유를 함께 적는다
const ALLOWED_PATTERNS = [
  "(?<=다\\.)", // 문장 경계: 마침표 뒤 공백 없이 이어진 평서문을 나눔
];

// 한글이 든 정규식 리터럴 · 문자 클래스·이스케이프를 건너뛰며 닫는 사선까지 읽는다
const HANGUL_REGEX =
  /\/(?![/*])(?:\\.|\[(?:\\.|[^\]\n])*\]|[^/\\\n[])*[가-힣](?:\\.|\[(?:\\.|[^\]\n])*\]|[^/\\\n[])*\/[dgimsuvy]*/g;

const article = "# 제목\n\n도입 문장이다.\n\n## 하나\n\n왜 그럴까? **밑줄.**\n\n닫는 줄.";
const outline = {
  title: "제목",
  sections: [
    {
      title: "하나",
      mode: "narrate",
      hook: "왜 그럴까?",
      underline: "밑줄.",
      principleLine: "닫는 줄.",
    },
  ],
};

test("JUDGE-001: 코드 지표는 등록된 것뿐이고 근거는 세기·글자 대조뿐", () => {
  const emitted = Object.keys(draftMetrics(article, { outline })).sort();
  assert.deepEqual(emitted, Object.keys(METRIC_BASIS).sort(), "지표를 더하면 METRIC_BASIS에 등록");
  for (const [name, basis] of Object.entries(METRIC_BASIS))
    assert.ok(["count", "exact"].includes(basis), `${name}: ${basis}는 코드 지표의 근거가 아님`);
});

test("JUDGE-001: 채점 기준의 근거는 세기·글자 대조·실행 기록·검토 판정뿐", () => {
  for (const { id, basis } of GRADERS)
    assert.ok(["count", "exact", "process", "review"].includes(basis), `${id}: ${basis}`);
});

test("JUDGE-001: 판정 코드에 한글 낱말을 담은 정규식이 없다", async () => {
  // 주석과 문자열(안내문)을 뺀 코드에서 찾는다
  for (const path of JUDGING_CODE) {
    const code = (await readFile(path, "utf8"))
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .map((line) => line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""'))
      .join("\n");
    const found = (code.match(HANGUL_REGEX) ?? []).filter(
      (literal) => !ALLOWED_PATTERNS.some((allowed) => literal.includes(allowed)),
    );
    assert.deepEqual(found, [], `${path}: 뜻 판정은 검토(LLM)에 맡긴다 · JUDGE-001`);
  }
});

test("JUDGE-001: 검사가 실제로 위반을 잡는다", () => {
  assert.ok("const HYPE = /(최고의|반드시)/;".match(HANGUL_REGEX), "낱말 목록 정규식");
  assert.ok("const POLITE = /(니다|세요)[.!]?$/;".match(HANGUL_REGEX), "어미 정규식");
  assert.equal("const heading = /^#{2,6}\\s.+$/gm;".match(HANGUL_REGEX), null, "문법 기호는 허용");
});
