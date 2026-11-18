import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

// 시험·검증 실행이 만드는 작업 폴더의 수명 SSoT: 한곳(.local/scratch/<이름>)에 만들고, 끝나면 지운다
// 실패한 검증 실행은 진단용으로 남기고, AIN_KEEP_SCRATCH=1이면 모두 남긴다
const ROOT = resolve(".local/scratch");
const keepAll = () => process.env.AIN_KEEP_SCRATCH === "1";

/** @param {string} name 실행 종류(폴더 이름) */
export async function scratchDir(name) {
  const base = join(ROOT, name);
  await mkdir(base, { recursive: true, mode: 0o700 });
  const path = await mkdtemp(join(base, "run-"));
  return {
    path,
    /** @param {{ failed?: boolean }} [options] */
    async release({ failed = false } = {}) {
      if (failed || keepAll()) return;
      await rm(path, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}

/**
 * node:test 시험용: 시험이 끝나면(t.after) 지운다
 * @param {{ after: (fn: () => unknown) => void }} t
 * @param {string} name
 */
export async function testScratch(t, name) {
  const scratch = await scratchDir(name);
  t.after(() => scratch.release());
  return scratch.path;
}
