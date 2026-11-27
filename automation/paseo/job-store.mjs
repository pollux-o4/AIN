import { createHash, randomUUID } from "node:crypto";
import { opendir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const JOB_ID = /^[a-f0-9]{64}$/;
export const isFinishedJob = (status) => status === "completed" || status === "failed";
export const jobIdFor = (body) => createHash("sha256").update(JSON.stringify(body)).digest("hex");

function indexJob(index, { id, agentId, status, deadline, deadlineStopAttempted }) {
  if (isFinishedJob(status)) index.delete(id);
  else index.set(id, { id, agentId, status, deadline, deadlineStopAttempted });
}

export class JobStore {
  #directory;
  #active;

  constructor(directory) {
    this.#directory = directory;
  }

  async read(id) {
    if (!JOB_ID.test(id)) throw new Error("Invalid job id");
    return JSON.parse(await readFile(join(this.#directory, `${id}.json`), "utf8"));
  }

  async save(job) {
    const temp = join(this.#directory, `${job.id}.${randomUUID()}.tmp`);
    try {
      await writeFile(temp, JSON.stringify(job), { mode: 0o600 });
      await rename(temp, join(this.#directory, `${job.id}.json`));
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {});
      throw error;
    }
    // 초기 스캔 중에 저장된 작업은 스캔 결과에 반영한다.
    const index = await this.#active?.catch(() => null);
    if (index) indexJob(index, job);
    return job;
  }

  async activeJobs() {
    this.#active ??= this.#loadActive().catch((error) => {
      this.#active = undefined;
      throw error;
    });
    return [...(await this.#active).values()];
  }

  async #loadActive() {
    const index = new Map();
    const dir = await opendir(this.#directory).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    if (!dir) return index;
    for await (const { name } of dir) {
      if (name.endsWith(".json") && JOB_ID.test(name.slice(0, -5))) {
        indexJob(index, await this.read(name.slice(0, -5)));
      }
    }
    return index;
  }
}
