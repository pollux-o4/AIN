// 내보내기: 확정된 글을 소비처와 무관한 표준 형식으로 · 어디서 쓸지는 받는 쪽이 정함 · ADR-0012
import { z } from "zod";
import { FIGURE_MARKS } from "../../contracts/figure.mjs";
import { isAnimated, staticSvg } from "../../contracts/svg-motion.mjs";
import { toTxt } from "../../contracts/txt.mjs";
import { escapeHtml, renderArticle } from "../article-html.mjs";
import { placeFigures } from "../domain/index.mjs";
import { zip } from "./zip.mjs";

const EXPORT_FORMATS = /** @type {const} */ (["txt", "html", "zip"]);
export const exportOptionsSchema = z.object({
  format: z.enum(EXPORT_FORMATS).default("txt"),
  // animated: SVG 자체 움직임 유지 · static: 첫 프레임으로 고정
  motion: z.enum(["animated", "static"]).default("animated"),
});
export const BUNDLE_FORMAT = "ain-article-bundle";
const BUNDLE_VERSION = 1;

const dataUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
const figureFile = (id, motion) => `figures/${id}${motion === "static" ? ".static" : ""}.svg`;

// 그림은 <img>로만 넣는다: 문서 CSS·id 충돌 없이 격리되고 스크립트가 돌지 않으며 SVG 자체 움직임은 그대로 재생
function figureHtml(item, src) {
  return (
    `<figure ${FIGURE_MARKS.figure}="${escapeHtml(item.id)}">` +
    `<img src="${escapeHtml(src)}" alt="${escapeHtml(item.alt)}" loading="lazy" decoding="async">` +
    (item.caption ? `<figcaption>${escapeHtml(item.caption)}</figcaption>` : "") +
    "</figure>"
  );
}
const STYLE = `:root{color-scheme:light dark;--fg:#1d1d1f;--muted:#6e6e73;--bg:#fff;--line:#e5e5ea}
@media (prefers-color-scheme:dark){:root{--fg:#f5f5f7;--muted:#a1a1a6;--bg:#111;--line:#2c2c2e}}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.75 system-ui,-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;word-break:keep-all}
article{max-width:42rem;margin:0 auto;padding:3rem 1rem 5rem}
h1{font-size:2rem;line-height:1.3}h2{margin-top:2.5em}pre{overflow-x:auto;padding:1rem;border:1px solid var(--line);border-radius:8px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}
table{border-collapse:collapse;width:100%}th,td{border:1px solid var(--line);padding:.4rem .6rem}
figure{margin:2rem 0}figure img{display:block;width:100%;height:auto}figcaption{margin-top:.5rem;color:var(--muted);font-size:.9rem;text-align:center}`;
const htmlDocument = (title, body) =>
  `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="generator" content="AIN">\n<title>${escapeHtml(title)}</title>\n<style>${STYLE}</style>\n</head>\n<body>\n<article>\n<h1>${escapeHtml(title)}</h1>\n${body}\n</article>\n</body>\n</html>\n`;

// Markdown 원고: 본문은 글자 그대로, 그림만 앵커 문단 뒤에 상대 경로 이미지로
function markdownWith(text, figures, motion) {
  return placeFigures(text, figures)
    .map((part) =>
      part.figure
        ? `\n\n![${part.figure.alt.replace(/[[\]]/g, "")}](${figureFile(part.figure.id, motion)})${part.figure.caption ? `\n\n*${part.figure.caption}*` : ""}`
        : part.text,
    )
    .join("");
}

/**
 * @param {{ id: string, title: string, revision: number, text: string, figures: any[] }} article
 * @param {{ format: string, motion: string }} options
 */
export function exportArticle(article, options) {
  const { format, motion } = exportOptionsSchema.parse(options);
  const base = `article-${article.id}-r${article.revision}`;
  const svgOf = (item) => (motion === "static" ? staticSvg(item.svg) : item.svg);
  if (format === "txt")
    return {
      body: toTxt(article.text),
      contentType: "text/plain; charset=utf-8",
      filename: `${base}.txt`,
    };
  if (format === "html")
    return {
      body: htmlDocument(
        article.title,
        renderArticle(article, (item) => figureHtml(item, dataUri(svgOf(item)))),
      ),
      contentType: "text/html; charset=utf-8",
      filename: `${base}.html`,
    };
  // zip: 원고(md)·문서(html)·본문 조각(파일 참조 html)·그림(움직임·정지판)·배치 매니페스트
  const figures = article.figures.map((item) => ({
    id: item.id,
    anchor: item.anchor,
    alt: item.alt,
    caption: item.caption ?? null,
    animated: isAnimated(item.svg),
    file: figureFile(item.id, "animated"),
    staticFile: figureFile(item.id, "static"),
  }));
  const files = [
    { name: "article.md", data: toTxt(markdownWith(article.text, article.figures, motion)) },
    {
      name: "article.html",
      data: htmlDocument(
        article.title,
        renderArticle(article, (item) => figureHtml(item, figureFile(item.id, motion))),
      ),
    },
    {
      name: "article-body.html",
      data: `${renderArticle(article, (item) => figureHtml(item, figureFile(item.id, motion)))}\n`,
    },
    ...article.figures.flatMap((item) => [
      { name: figureFile(item.id, "animated"), data: item.svg },
      { name: figureFile(item.id, "static"), data: staticSvg(item.svg) },
    ]),
  ];
  const manifest = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    article: { id: article.id, title: article.title, revision: article.revision },
    motion,
    entry: { markdown: "article.md", html: "article.html", fragment: "article-body.html" },
    // 그림은 anchor 문장이 든 문단 바로 뒤 · 본문은 글자 그대로라 받는 쪽이 다시 배치할 수 있음
    figures,
  };
  return {
    body: zip([
      { name: "manifest.json", data: `${JSON.stringify(manifest, null, 2)}\n` },
      ...files,
    ]),
    contentType: "application/zip",
    filename: `${base}.zip`,
  };
}
