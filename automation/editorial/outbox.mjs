// 보낼 폴더 어댑터 · 받는 쪽은 이 폴더의 파일만 읽고 AIN의 경로·DB·인증을 모른다(AGENTS 경계)
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** @param {string} dir 절대 경로 */
export function fileOutbox(dir) {
  return {
    async write(name, body) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const path = join(dir, name);
      // 받는 쪽이 쓰다 만 파일을 읽지 않도록 임시 파일에 쓴 뒤 바꿔 넣는다
      const temp = `${path}.${process.pid}.tmp`;
      await writeFile(temp, body, { mode: 0o600 });
      await rename(temp, path);
      return path;
    },
  };
}
