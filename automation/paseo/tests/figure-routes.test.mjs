import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FIGURE_KINDS } from "../../contracts/figure.mjs";
import { DEFAULT_ROUTE, legacyFigureResult } from "../../contracts/figure-result.mjs";
import { imageAdapter, imagePrompt } from "../figure-routes/adapters/image.mjs";
import { svgAdapter } from "../figure-routes/adapters/svg.mjs";
import { RouteRegistry } from "../figure-routes/registry.mjs";
import { renderFigure, renderFigures } from "../figure-routes/render.mjs";

// FIGURE-002 · 경로 어댑터 계약 · 외부 모델은 가짜 포트로 대신한다(TIME-001)
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><text>산길</text></svg>';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const input = (over = {}) => ({
  message: "갈림길에서 되돌아온다",
  elements: [{ name: "갈림길", quote: "갈림길" }],
  labels: [{ text: "산길" }],
  style: { accent: "주황" },
  motifs: [],
  direction: null,
  ...over,
});
const dir = () => mkdtemp(join(tmpdir(), "ain-route-"));
const ctx = async () => ({ dir: await dir(), signal: new AbortController().signal });
const clock = () => {
  let t = 0;
  return () => (t += 5);
};

function fakes() {
  const calls = { svg: 0, image: 0 };
  const svg = svgAdapter({
    id: "svg-fake",
    version: "1",
    draw: async () => {
      calls.svg++;
      return { svg: SVG, alt: "산길 그림", caption: null, model: "m", tokens: 10, checks: 1 };
    },
  });
  const image = (textInImage = true, labels) =>
    imageAdapter({
      id: "image-fake",
      version: "1",
      textInImage,
      client: {
        async generate({ dir: out }) {
          calls.image++;
          await writeFile(join(out, "f.png"), PNG);
          return {
            path: "f.png",
            mime: "image/png",
            alt: "산길 장면",
            model: "img",
            tokens: null,
            labels,
          };
        },
      },
    });
  return { calls, svg, image };
}
const deps = (adapters) => ({
  registry: new RouteRegistry(adapters),
  store: new Map(),
  now: clock(),
});

// 모든 어댑터가 같은 계약을 통과한다
for (const [name, make] of [
  ["svg", (f) => f.svg],
  ["image", (f) => f.image()],
]) {
  test(`figure_002 ${name}: 공통 결과 형식과 실행기 측정값`, async () => {
    const f = fakes();
    const adapter = make(f);
    const result = await renderFigure(
      deps([adapter]),
      { id: "f4", kind: null, route: name },
      input(),
      await ctx(),
    );
    assert.equal(result.route, name);
    assert.equal(result.provenance.adapter, adapter.id);
    assert.equal(result.provenance.ms, 5);
    assert.match(result.provenance.inputHash, /^[0-9a-f]{64}$/);
    assert.ok(result.files[0].bytes > 0);
    assert.deepEqual(
      result.labels.map((l) => l.text),
      ["산길"],
    );
  });
}

test("figure_002 경로 선택: 유형 기본 → 사람 지정 우선 · 어댑터 없으면 다른 경로로 바꾸지 않음", () => {
  const f = fakes();
  const registry = new RouteRegistry([f.svg]);
  assert.equal(registry.select({ kind: "flow" }).route, "svg");
  assert.throws(() => registry.select({ kind: "scene" }), /No adapter for route: image/);
  assert.throws(() => registry.select({ kind: "flow", route: "image" }), /No adapter/);
  assert.throws(() => new RouteRegistry([f.svg, f.svg]), /Duplicate/);
});

test("figure_002 재사용: 같은 입력·어댑터·버전이면 다시 호출하지 않음", async () => {
  const f = fakes();
  const d = deps([f.svg]);
  const c = await ctx();
  await renderFigure(d, { id: "f1", kind: "flow" }, input(), c);
  await renderFigure(d, { id: "f1", kind: "flow" }, input(), c);
  assert.equal(f.calls.svg, 1);
  await renderFigure(d, { id: "f1", kind: "flow" }, input({ message: "다른 메시지" }), c);
  assert.equal(f.calls.svg, 2);
});

test("figure_002 능력: 그림 밖 글자는 위치가 필요하고, 요청한 글자가 빠지면 실패", async () => {
  const f = fakes();
  await assert.rejects(
    renderFigure(deps([f.image(false)]), { id: "f4", kind: "scene" }, input(), await ctx()),
    /Requested label missing/,
  );
  const placed = await renderFigure(
    deps([f.image(false, [{ text: "산길", anchor: { x: 0.2, y: 0.8 } }])]),
    { id: "f4", kind: "scene" },
    input(),
    await ctx(),
  );
  assert.deepEqual(placed.labels[0].anchor, { x: 0.2, y: 0.8 });
  assert.match(imagePrompt(input(), false), /No text/);
  assert.match(imagePrompt(input(), true), /"산길"/);
});

test("figure_002 검사: 형식 서명이 다르거나 작업 폴더 밖 경로면 실패", async () => {
  const bad = imageAdapter({
    id: "bad",
    version: "1",
    textInImage: true,
    client: {
      async generate({ dir: out }) {
        await writeFile(join(out, "f.png"), SVG);
        return { path: "f.png", mime: "image/png", alt: "설명", model: "x", tokens: null };
      },
    },
  });
  await assert.rejects(
    renderFigure(deps([bad]), { id: "f4", kind: "scene" }, input(), await ctx()),
    /signature/,
  );
  const svg = fakes().svg;
  const outside = {
    ...svg,
    render: async (i, c) => ({
      ...(await svg.render(i, c)),
      files: [{ path: "../x.svg", mime: "image/svg+xml" }],
    }),
  };
  await assert.rejects(
    renderFigure(deps([outside]), { id: "f4", kind: "flow" }, input(), await ctx()),
    /inside the work folder/,
  );
});

test("figure_002 취소·병렬: 취소된 그림은 저장하지 않고, 실패는 그 그림에만 남음", async () => {
  const f = fakes();
  const d = deps([f.svg]);
  const aborted = new AbortController();
  aborted.abort();
  const results = await renderFigures(d, [
    { candidate: { id: "f1", kind: "flow" }, input: input(), ctx: await ctx() },
    {
      candidate: { id: "f2", kind: "flow" },
      input: input({ message: "둘" }),
      ctx: { dir: await dir(), signal: aborted.signal },
    },
    { candidate: { id: "f3", kind: "scene" }, input: input(), ctx: await ctx() },
  ]);
  assert.deepEqual(
    results.map((r) => r.ok),
    [true, false, false],
  );
  assert.equal(d.store.size, 1);
});

test("figure_002 호환: 이전 svg 결과는 svg 경로 결과로 읽는다", () => {
  const read = legacyFigureResult({ id: "f1", svg: SVG, alt: "설명" });
  assert.equal(read.route, "svg");
  assert.equal(read.files[0].mime, "image/svg+xml");
  assert.equal(read.provenance, null);
});

test("figure_002 경로 표: 모든 시각화 유형에 기본 경로가 있다", () => {
  assert.deepEqual(Object.keys(DEFAULT_ROUTE).sort(), Object.keys(FIGURE_KINDS).sort());
});
