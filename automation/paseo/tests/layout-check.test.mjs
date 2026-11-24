import assert from "node:assert/strict";
import test from "node:test";
import { axisNotes, kitIndex } from "../figure-tools/kit-index.mjs";
import { framing, freeShift, layoutIssues } from "../figure-tools/layout-check.mjs";

const view = { x: 0, y: 0, w: 100, h: 100 };
const label = (text, x, y) => ({ text, box: { x, y, w: 20, h: 8 } });
const line = (id, from, to) => ({
  id,
  points: Array.from({ length: 21 }, (_, i) => [
    from[0] + ((to[0] - from[0]) * i) / 20,
    from[1] + ((to[1] - from[1]) * i) / 20,
  ]),
});

test("배치 점검: 글자 겹침·잘림·글자를 지나는 선만 알리고 라벨에 닿는 지시선은 넘긴다", () => {
  const issues = layoutIssues({
    view,
    texts: [label("가", 10, 10), label("나", 15, 12), label("다", 90, 50), label("라", 40, 80)],
    strokes: [line("가로선", [30, 84], [70, 84]), line("지시선", [20, 60], [40, 84])],
  });
  assert.equal(issues.length, 3);
  assert.match(issues.join("\n"), /글자 겹침: "가".*"나"/);
  assert.match(issues.join("\n"), /잘림: "다"/);
  assert.match(issues.join("\n"), /"라" .*← 가로선/);
  assert.equal(layoutIssues({ view, texts: [label("가", 10, 10)], strokes: [] }).length, 0);
});

test("배치 점검: 겹친 글자마다 다른 글자·선·가장자리를 피하는 가장 가까운 빈자리를 제안한다", () => {
  const measured = {
    view,
    texts: [label("가", 10, 10), label("나", 15, 12)],
    strokes: [line("가로선", [0, 6], [100, 6])],
  };
  const [shift] = [freeShift(measured.texts[1], measured)];
  assert.ok(shift, "빈자리가 있어야 한다");
  const moved = {
    text: "나",
    box: { ...measured.texts[1].box, x: 15 + shift[0], y: 12 + shift[1] },
  };
  assert.deepEqual(layoutIssues({ ...measured, texts: [measured.texts[0], moved] }), []);
  assert.match(layoutIssues(measured).join("\n"), /빈자리 후보 translate\(/);
  const full = {
    view,
    texts: [label("가", 0, 0), { text: "꽉", box: { x: 0, y: 0, w: 100, h: 100 } }],
    strokes: [],
  };
  assert.equal(freeShift(full.texts[1], full), null);
});

test("키트 목록: 내보낸 함수·화살표 상수의 서명만 남기고 본문은 버린다", () => {
  const source = [
    "export const AZIMUTH = 45;",
    "export function iso([x, y, z], projection) {",
    "  return 1;",
    "}",
    "export const ring = (cx, cy, radius, z, projection, steps = 40) => onTop(cx);",
    "export const id = value => value;",
    "function hidden() {}",
  ].join("\n");
  assert.deepEqual(kitIndex(source), [
    "AZIMUTH",
    "iso([x, y, z], projection)",
    "ring(cx, cy, radius, z, projection, steps = 40)",
    "id(value)",
  ]);
});

test("배치 점검: 내용 상자 대비 여백과 내용에 맞춘 viewBox 후보를 낸다", () => {
  const report = framing({ view, content: { x: 30, y: 20, w: 40, h: 50 } });
  assert.match(report, /viewBox의 20%/);
  assert.match(report, /left 30 · top 20 · right 30 · bottom 30/);
  assert.match(report, /"14 4 72 82"/);
  assert.equal(framing({ view, content: null }), null);
});

test("키트 목록: 투영 함수로 축마다 화면 방향과 깊이를 말로 적는다", () => {
  const iso = ([x, y, z]) => [x - y, (x + y) / 2 - z];
  const notes = axisNotes(iso, ([x, y, z]) => x + y + z);
  assert.match(notes[1], /\+x → 화면 오른쪽 아래/);
  assert.match(notes[2], /\+y → 화면 왼쪽 아래/);
  assert.match(notes[3], /\+z → 화면 위 .*깊이 \+1/);
});
