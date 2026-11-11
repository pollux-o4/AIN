import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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

  async #update(articleId, change) {
    const path = this.#path(articleId);
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

  async put(articleId, role, { agentId, providerModel, delivered }) {
    await this.#update(articleId, (entries) => {
      entries[role] = { agentId, providerModel, delivered, updatedAt: new Date().toISOString() };
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
