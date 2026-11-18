import assert from "node:assert/strict";
import test from "node:test";
import { crc32 } from "node:zlib";
import { svgIssue } from "../../contracts/figure.mjs";
import { BUNDLE_FORMAT, exportArticle } from "../export/index.mjs";
import { isAnimated, staticSvg } from "../export/motion.mjs";

const MOVING =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>@keyframes up{to{transform:translateY(-2px)}}.h{animation:up 2s infinite}@media (prefers-reduced-motion:reduce){.h{animation:none}}</style><rect class="h" width="4" height="4"><animate attributeName="opacity" values="1;.5;1" dur="2s" repeatCount="indefinite"/></rect><set attributeName="fill" to="red" begin="1s"/></svg>';
const TEXT = "# 제목\n\n첫 문단. 앵커 문장.\n\n둘째 문단.\n";
const article = {
  id: "run-1",
  title: "제목",
  revision: 2,
  text: TEXT,
  figures: [{ id: "f1", anchor: "앵커 문장.", alt: "그림 [설명]", caption: "캡션", svg: MOVING }],
};

// 받는 쪽이 ZIP 도구 없이도 검증할 수 있게 표준 로컬 헤더만 읽는다
function unzip(buffer) {
  const files = new Map();
  for (let at = 0; buffer.readUInt32LE(at) === 0x04034b50; ) {
    const size = buffer.readUInt32LE(at + 18);
    const nameLength = buffer.readUInt16LE(at + 26);
    const name = buffer.subarray(at + 30, at + 30 + nameLength).toString("utf8");
    const data = buffer.subarray(at + 30 + nameLength, at + 30 + nameLength + size);
    assert.equal(crc32(data), buffer.readUInt32LE(at + 14), name);
    files.set(name, data.toString("utf8"));
    at += 30 + nameLength + size;
  }
  return files;
}

test("ADR-0011 움직이는 SVG: SMIL·CSS 움직임 허용, 주소·이벤트를 바꾸는 애니메이션 거부", () => {
  assert.equal(svgIssue(MOVING), null);
  for (const bad of [
    '<svg><a href="#x"><set attributeName="href" to="#y"/></a></svg>',
    '<svg><animate attributeName="xlink:href" values="#a"/></svg>',
    '<svg><set attributeName="onclick" to="x"/></svg>',
    '<svg><set attributeName="fill" to="javascript:alert(1)"/></svg>',
  ])
    assert.ok(svgIssue(bad), bad);
});

test("ADR-0012 정지판: 애니메이션 요소를 지우고 CSS 움직임을 멈춰 첫 장면으로 고정", () => {
  assert.ok(isAnimated(MOVING));
  const still = staticSvg(MOVING);
  assert.equal(isAnimated(still.replace(/<style>\*\{animation:none[^<]*<\/style>/, "")), true);
  assert.doesNotMatch(still, /<(animate|set)\b/);
  assert.match(still, /^<svg[^>]*><style>\*\{animation:none!important/);
  assert.equal(svgIssue(still), null);
  const plain = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
  assert.equal(staticSvg(plain), plain);
});

test("ADR-0012 내보내기: TXT는 본문 그대로, HTML은 그림을 격리된 img로 앵커 뒤에", () => {
  const txt = exportArticle(article, { format: "txt" });
  assert.equal(txt.body, TEXT);
  assert.equal(txt.filename, "article-run-1-r2.txt");
  const html = exportArticle(article, { format: "html" }).body;
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>제목<\/title>/);
  assert.doesNotMatch(html, /<script|<svg/);
  const [before, after] = html.split("<figure");
  assert.match(before, /앵커 문장/);
  assert.match(after, /둘째 문단/);
  const src = html.match(/src="data:image\/svg\+xml;base64,([^"]+)"/)[1];
  assert.equal(Buffer.from(src, "base64").toString("utf8"), MOVING);
  const still = exportArticle(article, { format: "html", motion: "static" }).body;
  const stillSrc = still.match(/base64,([^"]+)"/)[1];
  assert.doesNotMatch(Buffer.from(stillSrc, "base64").toString("utf8"), /<animate/);
  assert.throws(() => exportArticle(article, { format: "pdf" }));
});

test("ADR-0012 묶음: 원고·문서·조각·그림 두 판·매니페스트가 같은 배치를 가리킨다", () => {
  const file = exportArticle(article, { format: "zip" });
  assert.equal(file.contentType, "application/zip");
  const files = unzip(file.body);
  assert.deepEqual(
    [...files.keys()],
    [
      "manifest.json",
      "article.md",
      "article.html",
      "article-body.html",
      "figures/f1.svg",
      "figures/f1.static.svg",
    ],
  );
  const manifest = JSON.parse(files.get("manifest.json"));
  assert.equal(manifest.format, BUNDLE_FORMAT);
  assert.deepEqual(manifest.figures[0], {
    id: "f1",
    anchor: "앵커 문장.",
    alt: "그림 [설명]",
    caption: "캡션",
    animated: true,
    file: "figures/f1.svg",
    staticFile: "figures/f1.static.svg",
  });
  // 본문은 글자 그대로, 그림만 앵커 문단 뒤
  const md = files.get("article.md");
  assert.equal(md.replace(/\n\n!\[[^\n]*\n\n\*캡션\*/, ""), TEXT);
  assert.match(md, /앵커 문장\.\n\n!\[그림 설명\]\(figures\/f1\.svg\)/);
  assert.match(files.get("article-body.html"), /src="figures\/f1\.svg"/);
  assert.equal(files.get("figures/f1.svg"), MOVING);
  const empty = unzip(exportArticle({ ...article, figures: [] }, { format: "zip" }).body);
  assert.deepEqual(JSON.parse(empty.get("manifest.json")).figures, []);
});
