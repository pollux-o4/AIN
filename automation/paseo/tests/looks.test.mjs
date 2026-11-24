// 그림 스타일: 계약의 목록과 규칙이 같은 id를 쓰고, 구성이 고른 스타일만 생성 지시문에 실린다 · ADR-0027
import assert from "node:assert/strict";
import test from "node:test";
import { FIGURE_LOOKS, figureOutputSchemas } from "../../contracts/figure.mjs";
import { bindConsistency } from "../../editorial/domain/figure-consistency.mjs";
import { figureSpec } from "../prompts/figure.mjs";
import { LOOK_RULES } from "../prompts/looks.mjs";

const flat = (spec) => [...spec.steps, ...spec.rules, ...spec.guards].join("\n");

test("계약의 스타일 목록과 그리기 규칙이 같은 id를 쓴다", () => {
  assert.deepEqual(Object.keys(LOOK_RULES).sort(), Object.keys(FIGURE_LOOKS).sort());
});

test("고른 스타일의 규칙만 생성 지시문에 싣고, 없거나 모르는 스타일은 anatomy로 그린다", () => {
  const spec = (look) => flat(figureSpec({ stage: "figure", style: look && { look } }));
  assert.ok(spec("sketchnote").includes(LOOK_RULES.sketchnote.draw));
  assert.ok(!spec("sketchnote").includes(LOOK_RULES.anatomy.draw));
  assert.ok(!spec("sketchnote").includes("kit 폴더"));
  assert.ok(!spec("sketchnote").includes("{"), "치환되지 않은 자리표시가 없다");
  for (const fallback of [undefined, "unknown"]) {
    assert.ok(spec(fallback).includes(LOOK_RULES.anatomy.draw));
    assert.ok(spec(fallback).includes("kit 폴더"));
  }
});

test("구성 결과의 스타일은 계약 목록 안의 값만 남고 정규화 뒤에도 유지된다", () => {
  const style = { accent: "a", base: "b", labels: "c" };
  const compose = figureOutputSchemas.figure_compose.shape.style;
  assert.equal(compose.parse({ ...style, look: "manual" }).look, "manual");
  assert.equal(compose.parse({ ...style, look: "watercolor" }).look, undefined);
  assert.equal(bindConsistency({ style: { ...style, look: "stick" } }, []).style.look, "stick");
  assert.equal("look" in bindConsistency({ style }, []).style, false);
});
