import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  finalResultBlock,
  inlineFigureFiles,
  withoutFigureBodies,
  writeFigureInputs,
} from "../figure-files.mjs";

// FIGURE-001: 생성 결과의 svgFile은 AI 작업 루트 안 파일만 svg 본문으로 바뀐다
test("svgFile: 작업 루트 안 파일만 읽고 밖은 거부", async () => {
  const base = await mkdtemp(join(tmpdir(), "ain-figure-files-"));
  const root = join(base, "workspaces");
  await mkdir(join(root, "job"), { recursive: true });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect/></svg>';
  const inside = join(root, "job", "f1.svg");
  const outside = join(base, "f1.svg");
  await writeFile(inside, svg);
  await writeFile(outside, svg);
  const msg = (path) => JSON.stringify({ figures: [{ id: "f1", svgFile: path, alt: "설명" }] });
  assert.deepEqual(JSON.parse(await inlineFigureFiles(msg(inside), root)).figures[0], {
    id: "f1",
    alt: "설명",
    svg,
  });
  await assert.rejects(inlineFigureFiles(msg(outside), root), /outside the AI work root/);
  await assert.rejects(
    inlineFigureFiles(msg(join(root, "job", "..", "..", "f1.svg")), root),
    /outside/,
  );
  await assert.rejects(inlineFigureFiles(msg("f1.svg"), root), /absolute path/);
  // svg 본문을 직접 준 결과는 그대로
  const direct = JSON.stringify({ figures: [{ id: "f1", svg, alt: "a" }] });
  assert.equal(await inlineFigureFiles(direct, root), direct);
});

// ADR-0026: 그림 원본(sourceFile)도 작업 루트 안에서만 글자로 읽고, 다음 층에 파일로 다시 넘긴다 · 기록에는 남기지 않음
test("sourceFile: 원본을 읽어 보관하고 다음 층 입력 파일로 되돌린다", async () => {
  const base = await mkdtemp(join(tmpdir(), "ain-figure-source-"));
  const root = join(base, "workspaces");
  await mkdir(join(root, "job"), { recursive: true });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect/></svg>';
  const source = "export const scene = 1;\n";
  await writeFile(join(root, "job", "f1.svg"), svg);
  await writeFile(join(root, "job", "f1.source.mjs"), source);
  await writeFile(join(base, "f1.source.mjs"), source);
  const msg = (sourceFile) =>
    JSON.stringify({
      figures: [{ id: "f1", svgFile: join(root, "job", "f1.svg"), sourceFile, alt: "a" }],
    });
  const [made] = JSON.parse(
    await inlineFigureFiles(msg(join(root, "job", "f1.source.mjs")), root),
  ).figures;
  assert.deepEqual([made.source, made.sourceFile], [source, undefined]);
  await assert.rejects(inlineFigureFiles(msg(join(base, "f1.source.mjs")), root), /outside/);
  const cwd = join(root, "next");
  await mkdir(cwd);
  const [input] = await writeFigureInputs(cwd, [{ id: "f1", svg, source, notes: "n" }]);
  assert.equal(await readFile(input.sourceFile, "utf8"), source);
  const [plain] = await writeFigureInputs(cwd, [{ id: "f1", svg }]);
  assert.equal(plain.sourceFile, undefined);
  assert.deepEqual(withoutFigureBodies({ previous: [{ id: "f1", svg, source }] }).previous, [
    { id: "f1" },
  ]);
});

// 도구 작업 뒤 claude 응답은 확인용 첨부 뒤에 결과를 붙인다 · 결과 없으면 진행 중
test("finalResultBlock: 앞선 첨부·메모 뒤 결과만 고른다", () => {
  assert.equal(finalResultBlock('{"figures":[]}'), '{"figures":[]}');
  assert.equal(finalResultBlock('\n\n![Image](file:///x.png)\n\n{"figures":[]}'), '{"figures":[]}');
  assert.equal(
    finalResultBlock('메모\n```json\n{"figures":[]}\n```'),
    '```json\n{"figures":[]}\n```',
  );
  assert.equal(finalResultBlock("- 렌더 확인 중"), null);
});

test("parseLastValid: 이어 쓴 세션이 이전 형식 JSON을 함께 내도 형식에 맞는 마지막 객체만 쓴다", async () => {
  const { z } = await import("zod");
  const { jsonBlocks, parseLastValid } = await import("../result-blocks.mjs");
  const schema = z.object({ readers: z.string() });
  const twice = '{"topic":"GoF {패턴}"}\n{"readers":"개발자 \\"입문\\""}';
  assert.equal(jsonBlocks(twice).length, 2);
  assert.deepEqual(parseLastValid(twice, schema), { readers: '개발자 "입문"' });
  assert.deepEqual(parseLastValid('```json\n{"readers":"a"}\n```', schema), { readers: "a" });
  assert.throws(() => parseLastValid('{"topic":"x"}', schema), /JSON 후보 1개/);
  assert.throws(() => parseLastValid("설명만", schema), /No JSON object \(JSON 후보 0개\)/);
});
