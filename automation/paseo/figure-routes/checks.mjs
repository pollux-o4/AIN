import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { svgIssue } from "../../contracts/figure.mjs";
import { FIGURE_MIMES } from "../../contracts/figure-result.mjs";

// 파일 형식별 검사 · 형식마다 검사 하나(FIGURE-002 경로별 검사) · 새 형식은 표에 한 줄 추가
const signature = (/** @type {number[]} */ bytes) => (/** @type {Buffer} */ data) =>
  bytes.every((b, i) => data[i] === b) ? null : "File signature does not match mime";
/** @type {Record<string, (data: Buffer) => string | null>} */
const BY_MIME = {
  "image/svg+xml": (data) => svgIssue(data.toString("utf8")),
  "image/png": signature([0x89, 0x50, 0x4e, 0x47]),
  "image/webp": (data) =>
    data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP"
      ? null
      : "File signature does not match mime",
};

// 작업 폴더 안 파일만 읽고 크기를 잰다 · 통과하면 bytes를 붙여 돌려준다
/** @param {string} dir @param {{ path: string, mime: string }[]} files */
export async function checkFiles(dir, files) {
  return Promise.all(
    files.map(async (file) => {
      if (!/^[\w.-]+$/.test(file.path))
        throw new Error("File path must stay inside the work folder");
      const check = BY_MIME[file.mime];
      if (!check) throw new Error(`Unsupported mime: ${file.mime}`);
      const data = await readFile(join(dir, file.path));
      if (data.length > FIGURE_MIMES[/** @type {keyof typeof FIGURE_MIMES} */ (file.mime)].limit)
        throw new Error("File too large");
      const issue = check(data);
      if (issue) throw new Error(issue);
      return { ...file, bytes: data.length };
    }),
  );
}
