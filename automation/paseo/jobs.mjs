import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";

const exec = promisify(execFile);

import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { outputFields } from "../contracts/output-fields.mjs";
import { nextAction, transition } from "../editorial/domain/index.mjs";
import { watchTimeline } from "./activity.mjs";
import { promptContext, summarizeInputs } from "./context.mjs";
import { buildPrompt, resultEvent } from "./prompts.mjs";
import { roleOf } from "./roles.mjs";
import { RoleSessions } from "./sessions.mjs";

export class Jobs {
  #sessions;
  // shortcut: 단일 브리지 프로세스의 작업 잠금 사용, 다중 인스턴스 운영 전 공유 저장소·원자적 잠금 전환
  constructor({
    client,
    root,
    workRoot,
    allowedProviders = null,
    reuseProviders,
    cancel = async (id) => exec("paseo", ["stop", id], { timeout: 10000 }),
  }) {
    Object.assign(this, { client, root, workRoot, allowedProviders, cancel });
    this.locks = new Map();
    this.#sessions = new RoleSessions({
      client,
      root,
      save: (job) => this.save(job),
      reuseProviders,
    });
  }
  async locked(id, fn) {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(fn);
    this.locks.set(id, task);
    try {
      return await task;
    } finally {
      if (this.locks.get(id) === task) this.locks.delete(id);
    }
  }
  async save(job) {
    const temp = join(this.root, `${job.id}.tmp`);
    await writeFile(temp, JSON.stringify(job), { mode: 0o600 });
    await rename(temp, join(this.root, `${job.id}.json`));
    return job;
  }
  async read(id) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid job id");
    return JSON.parse(await readFile(join(this.root, `${id}.json`), "utf8"));
  }
  async find(body) {
    const id = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    try {
      return await this.read(id);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  async stop(id) {
    return this.locked(id, async () => {
      const job = await this.read(id);
      if (["completed", "failed"].includes(job.status)) return job;
      await this.cancelAndConfirm(job);
      job.status = "failed";
      job.failureKind = "cancelled";
      job.error = "Stopped by user";
      return this.save(job);
    });
  }
  async cancelAndConfirm(job) {
    await this.#sessions.drop(job);
    await this.cancel(job.agentId);
    const stopped = await this.client.agents.ref(job.agentId).waitForFinish(1000);
    if (!["idle", "error"].includes(stopped.status))
      throw new Error("AI stop has not been confirmed");
  }
  async describe(id) {
    const job = await this.read(id);
    const context = promptContext(job.state, job.action);
    const stage = job.action.stage ?? "route";
    const output = job.event?.output;
    return {
      model: job.providerModel,
      status: job.status,
      failureKind: job.failureKind ?? null,
      feedback: context.feedback ?? null,
      inputs: job.inputSummary ?? summarizeInputs(context),
      inputsRecorded: Boolean(job.inputSummary),
      output: output
        ? Object.fromEntries(
            (outputFields[stage] ?? [])
              .filter(([key]) => Object.hasOwn(output, key))
              .map(([key]) => [
                key,
                key === "evidence"
                  ? output[key].map(({ claim, url }) => ({ claim, url }))
                  : output[key],
              ]),
          )
        : null,
      target: job.event?.target ?? null,
      reason: job.event?.reason ?? null,
    };
  }
  async watchActivity(id, emit) {
    const job = await this.read(id);
    if (!job.agentId) {
      emit({ phase: "waiting" });
      return () => {};
    }
    return watchTimeline(this.client.agents.ref(job.agentId), emit);
  }
  async providers() {
    const data = await this.client.providers.waitForReady({ cwd: this.workRoot, timeoutMs: 15000 });
    return data.entries
      .filter((x) => !this.allowedProviders || this.allowedProviders.includes(x.provider))
      .map((x) => ({ provider: x.provider, status: x.status, models: x.models ?? [] }));
  }
  async create({ state, ai }) {
    const action = nextAction(state);
    if (
      !Number.isSafeInteger(state.version) ||
      !Number.isSafeInteger(state.revision) ||
      state.revision < 1
    )
      throw new Error("Invalid editorial state");
    if (
      action.type === "request_ai" &&
      ![
        "diagnose",
        "topic",
        "audience",
        "value",
        "research",
        "outline",
        "draft",
        "review",
      ].includes(action.stage)
    )
      throw new Error("Invalid stage");
    if (!["request_ai", "request_route"].includes(action.type))
      throw new Error("No pending AI action");
    if (
      !ai ||
      typeof ai.provider !== "string" ||
      (this.allowedProviders && !this.allowedProviders.includes(ai.provider))
    )
      throw new Error("Provider is not enabled");
    if (typeof ai.model !== "string" || !ai.model.trim())
      throw new Error("Explicit model selection required");
    // 상태·AI 선택이 같으면 같은 작업 회수; HTTP 재전송으로 새 에이전트 생성 방지.
    const id = createHash("sha256").update(JSON.stringify({ state, ai })).digest("hex");
    return this.locked(`article:${state.articleId}`, () =>
      this.locked(id, async () => {
        await mkdir(this.root, { recursive: true, mode: 0o700 });
        try {
          return await this.read(id);
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
        const providers = await this.providers();
        const provider = providers.find((p) => p.provider === ai.provider && p.status === "ready");
        if (!provider)
          throw new Error("Selected provider is unavailable; inspect Paseo login/setup");
        const model = provider.models.find((m) => m.id === ai.model);
        if (!model) throw new Error("Selected model is unavailable; choose a discovered model");
        const duration = ai.maxDurationMs ?? 60000;
        if (!Number.isSafeInteger(duration) || duration < 1000 || duration > 120000)
          throw new Error("Invalid job duration limit");
        const job = {
          id,
          agentId: randomUUID(),
          state,
          action,
          ai,
          deadline: Date.now() + duration,
          providerModel: `${ai.provider}/${model.id}`,
          status: "starting",
          createdAt: new Date().toISOString(),
          inputSummary: summarizeInputs(promptContext(state, action)),
          ...(!ai.pilot && roleOf(action) ? { role: roleOf(action) } : {}),
        };
        await this.save(job);
        const cwd = join(this.workRoot, id);
        await mkdir(cwd, { recursive: true, mode: 0o700 });
        try {
          const context = promptContext(state, action);
          if ((await this.#sessions.acquire(job, context)).reused) {
            job.status = "running";
            return await this.save(job);
          }
          const agent = await this.client.agents.create({
            idempotencyKey: `editorial-${id}`,
            agentId: job.agentId,
            config: { provider: job.providerModel },
            cwd,
            prompt: buildPrompt(state, action, ai),
            title: `블로그 ${action.stage ?? "피드백 라우팅"} r${state.revision} · ${typeof state.idea === "string" ? state.idea.split("\n")[0].slice(0, 50) : state.articleId}`,
            labels: { source: "ain-n8n", job: id },
            background: true,
          });
          job.agentId = agent.id;
          await this.#sessions.register(job, agent.id, context);
          job.status = "running";
          return await this.save(job);
        } catch (error) {
          await this.#sessions.drop(job);
          job.diagnostic = String(error.message)
            .replace(/https?:\/\/\S+/g, "[URL]")
            .slice(0, 1200);
          job.status = "needs_attention";
          job.error = "Paseo agent creation failed; inspect daemon before retrying";
          return await this.save(job);
        }
      }),
    );
  }
  async expire() {
    let files;
    try {
      files = await readdir(this.root);
    } catch (e) {
      if (e.code === "ENOENT") return;
      throw e;
    }
    for (const file of files.filter((x) => /^[a-f0-9]{64}\.json$/.test(x))) {
      const job = await this.read(file.slice(0, -5));
      if (
        job.deadline &&
        Date.now() > job.deadline &&
        !job.deadlineStopAttempted &&
        ["starting", "running", "permission", "needs_attention"].includes(job.status)
      )
        await this.poll(job.id);
    }
  }
  async poll(id) {
    return this.locked(id, async () => {
      const job = await this.read(id);
      if (["completed", "failed"].includes(job.status)) return job;
      if (!job.agentId) {
        job.status = "needs_attention";
        job.error = "Creation interrupted; verify existing Paseo session before retrying";
        return this.save(job);
      }
      const agent = this.client.agents.ref(job.agentId);
      let result;
      try {
        result =
          job.status === "needs_attention"
            ? { status: "timeout" }
            : await agent.waitForFinish(1000);
      } catch (error) {
        await this.#sessions.drop(job);
        throw error;
      }
      try {
        result = await this.#sessions.verifyTurn(job, agent, result);
      } catch {
        await this.#sessions.drop(job);
        job.status = "needs_attention";
        job.error = "Worker turn could not be verified; inspect Paseo session";
        return this.save(job);
      }
      if (
        ["timeout", "permission"].includes(result.status) &&
        job.deadline &&
        Date.now() > job.deadline &&
        !job.deadlineStopAttempted
      ) {
        job.deadlineStopAttempted = true;
        try {
          await this.cancelAndConfirm(job);
          job.status = "failed";
          job.error = "AI deadline exceeded; stop requested";
          job.failureKind = "timeout";
          await this.#sessions.release(job, agent);
        } catch {
          job.status = "needs_attention";
          job.error = "AI deadline exceeded; stop could not be confirmed";
        }
        return this.save(job);
      }
      if (job.status === "needs_attention") return job;
      if (result.status === "timeout") {
        job.status = "running";
        return job;
      }
      if (result.status === "permission") {
        job.status = "permission";
        return this.save(job);
      }
      if (result.status === "error") {
        const detail = String(result.error ?? agent.lastError ?? "");
        job.failureKind = /quota|usage limit|rate limit/i.test(detail)
          ? "usage_limit"
          : /auth|login|sign.in/i.test(detail)
            ? "authentication"
            : "provider_error";
        job.status = "failed";
        job.error =
          job.failureKind === "usage_limit"
            ? "Selected AI usage limit reached; no fallback performed"
            : job.failureKind === "authentication"
              ? "Selected AI login required"
              : "AI provider failed; inspect Paseo session";
      } else if (result.status === "idle") {
        try {
          job.event = resultEvent(job, result.lastMessage);
          transition(job.state, job.event);
          if (job.ai.pilot && job.event.output?.marker !== job.state.articleId)
            throw new Error("Pilot marker mismatch");
          job.usage = this.#sessions.turnUsage(job, agent, result);
          job.status = "completed";
        } catch {
          delete job.event;
          job.status = "failed";
          job.error = "AI output did not satisfy the editorial contract; inspect Paseo session";
        }
      } else {
        job.status = "needs_attention";
        job.error = "Unknown provider status";
      }
      if (["failed", "needs_attention"].includes(job.status)) await this.#sessions.drop(job);
      if (["completed", "failed"].includes(job.status)) await this.#sessions.release(job, agent);
      return this.save(job);
    });
  }
}
