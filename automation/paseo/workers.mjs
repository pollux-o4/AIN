import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export class Workers {
  #root;
  #locks = new Map();

  constructor(root) {
    this.#root = join(root, "workers");
  }

  #path(articleId) {
    return join(this.#root, `${createHash("sha256").update(articleId).digest("hex")}.json`);
  }

  async #read(path) {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw error;
    }
  }

  async get(articleId, role) {
    return (await this.#read(this.#path(articleId)))[role] ?? null;
  }

  /** 대기 담당 전체 · 수명 정리(lifecycle)가 상한·유휴 시간을 판정한다 */
  async list() {
    let files;
    try {
      files = await readdir(this.#root);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const entries = [];
    for (const file of files.filter((name) => /^[a-f0-9]{64}\.json$/.test(name))) {
      const path = join(this.#root, file);
      for (const [role, entry] of Object.entries(await this.#read(path)))
        entries.push({
          path,
          role,
          agentId: entry.agentId,
          updatedAt: Date.parse(entry.updatedAt) || 0,
        });
    }
    return entries;
  }

  /** list()가 돌려준 항목을 내려놓는다 · 그사이 다른 세션으로 바뀌었으면 두지 않는다 */
  async dropEntry({ path, role, agentId }) {
    await this.#updatePath(path, (entries) => {
      if (entries[role]?.agentId !== agentId) return false;
      delete entries[role];
      return true;
    });
  }

  async #update(articleId, change) {
    await this.#updatePath(this.#path(articleId), change);
  }

  async #updatePath(path, change) {
    const previous = this.#locks.get(path) ?? Promise.resolve();
    const task = previous
      .catch(() => {})
      .then(async () => {
        const entries = await this.#read(path);
        if (!change(entries)) return;
        await mkdir(this.#root, { recursive: true, mode: 0o700 });
        const temp = `${path}.${randomUUID()}.tmp`;
        try {
          await writeFile(temp, JSON.stringify(entries), { mode: 0o600, flag: "wx" });
          await rename(temp, path);
        } finally {
          await rm(temp, { force: true });
        }
      });
    this.#locks.set(path, task);
    try {
      await task;
    } finally {
      if (this.#locks.get(path) === task) this.#locks.delete(path);
    }
  }

  async put(articleId, role, { agentId, delivered }) {
    await this.#update(articleId, (entries) => {
      entries[role] = { agentId, delivered, updatedAt: new Date().toISOString() };
      return true;
    });
  }

  async drop(articleId, role, agentId) {
    await this.#update(articleId, (entries) => {
      if (!entries[role] || (agentId && entries[role].agentId !== agentId)) return false;
      delete entries[role];
      return true;
    });
  }
}
