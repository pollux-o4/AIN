// 연구소 저장소 · <root>/<사례>/<변형>/<단계>-<회차>/record.json 과 결과 파일 · 원문이 섞일 수 있어 .local 아래에만 둔다
// lab.json은 기록 전체를 모은 색인 · 화면(Storybook)은 이 색인과 결과 파일만 읽는다
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { labRecordSchema, labSchema } from "../../contracts/lab.mjs";

export const LAB_ROOT = ".local/figure-lab";

/** @param {{ case: string, variant: string, stage: string, trial: number }} r */
const recordDir = (root, r) => join(root, r.case, r.variant, `${r.stage}-${r.trial}`);

/**
 * @param {string} root
 * @param {unknown} record
 * @param {{ from: string, path: string, mime: string }[]} files 결과 파일 원본 경로와 저장 이름
 */
export async function writeLabRecord(root, record, files = []) {
  const parsed = labRecordSchema.parse({
    .../** @type {object} */ (record),
    files: files.map(({ path, mime }) => ({ path, mime })),
  });
  const dir = recordDir(root, parsed);
  await mkdir(dir, { recursive: true });
  for (const file of files) await copyFile(file.from, join(dir, file.path));
  await writeFile(join(dir, "record.json"), `${JSON.stringify(parsed, null, 2)}\n`);
  return parsed;
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.name === "record.json") yield path;
  }
}

/** @param {string} root @param {unknown[]} variants */
export async function readLab(root, variants) {
  const records = [];
  for await (const path of walk(root)) records.push(JSON.parse(await readFile(path, "utf8")));
  return labSchema.parse({ variants, records });
}

/** @param {string} root @param {unknown[]} variants */
export async function writeLabIndex(root, variants) {
  const lab = await readLab(root, variants);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "lab.json"), `${JSON.stringify(lab, null, 2)}\n`);
  return lab;
}

/** 판정 기록 · 사람이나 검토가 내린 판정을 해당 회차에 붙인다(JUDGE-001) */
export async function judgeLabRecord(root, key, verdict) {
  const path = join(recordDir(root, key), "record.json");
  const record = labRecordSchema.parse(JSON.parse(await readFile(path, "utf8")));
  const next = labRecordSchema.parse({ ...record, verdict });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
