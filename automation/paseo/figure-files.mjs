import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, sep } from "node:path";
import { FIGURE_ID, FIGURE_LIMITS } from "../contracts/figure.mjs";

// 도구 작업 뒤 마지막 응답에서 결과 블록만: claude는 결과 앞에 확인용 첨부·메모를 붙인다 · 결과가 없으면 null
export function finalResultBlock(message) {
  const text = String(message ?? "").trim();
  if (/^(\{|```)/.test(text)) return text;
  const start = text.endsWith("```")
    ? text.lastIndexOf("\n```", text.length - 5)
    : text.lastIndexOf("\n{");
  return start < 0 ? null : text.slice(start + 1);
}

// 시각자료 생성 결과의 svgFile(작업 폴더의 SVG 파일)을 svg 본문으로 바꾼다 · ADR-0011
// 큰 SVG를 모델 응답 문자열에 싣지 않기 위함 · 경로는 AI 작업 루트 안만 허용
export async function inlineFigureFiles(message, workRoot) {
  const text = message.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/, "$1");
  const output = JSON.parse(text);
  if (!Array.isArray(output?.figures)) return message;
  const root = (await realpath(workRoot)) + sep;
  for (const figure of output.figures) {
    if (typeof figure?.svgFile !== "string") continue;
    if (!isAbsolute(figure.svgFile)) throw new Error("svgFile must be an absolute path");
    const path = await realpath(figure.svgFile);
    if (!path.startsWith(root)) throw new Error("svgFile is outside the AI work root");
    if ((await stat(path)).size > FIGURE_LIMITS.svg * 4) throw new Error("svgFile is too large");
    figure.svg = await readFile(path, "utf8");
    delete figure.svgFile;
    if (typeof figure.sourceFile === "string") {
      figure.source = await readInRoot(figure.sourceFile, root, FIGURE_LIMITS.source);
      delete figure.sourceFile;
    }
  }
  return JSON.stringify(output);
}

async function readInRoot(file, root, limit) {
  if (!isAbsolute(file)) throw new Error("sourceFile must be an absolute path");
  const path = await realpath(file);
  if (!path.startsWith(root)) throw new Error("sourceFile is outside the AI work root");
  if ((await stat(path)).size > limit * 4) throw new Error("sourceFile is too large");
  return readFile(path, "utf8");
}
// 앞 층 결과를 작업 폴더 파일로 넘긴다 · 큰 SVG를 프롬프트에 싣지 않음 · 응답 계약과 같은 svgFile 모양
export async function writeFigureInputs(cwd, previous) {
  return Promise.all(
    previous.map(async ({ svg, source, ...rest }) => {
      if (!FIGURE_ID.test(rest.id)) throw new Error("Invalid figure id");
      const svgFile = join(cwd, `input-${rest.id}.svg`);
      await writeFile(svgFile, svg, { mode: 0o600 });
      if (!source) return { ...rest, svgFile };
      const sourceFile = join(cwd, `input-${rest.id}.source.mjs`);
      await writeFile(sourceFile, source, { mode: 0o600 });
      return { ...rest, svgFile, sourceFile };
    }),
  );
}
// 작업 기록에는 SVG 본문을 남기지 않는다(상태 파일에 원본이 있음)
export const withoutFigureBodies = (action) =>
  action.previous
    ? {
        ...action,
        previous: action.previous.map(({ svg: _svg, source: _source, ...rest }) => rest),
      }
    : action;
