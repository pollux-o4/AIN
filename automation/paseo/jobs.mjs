import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { currentModel } from "../contracts/ai-models.mjs";
import { FIGURE_LIMITS, FIGURE_STAGES } from "../contracts/figure.mjs";
import { itemFields, outputFields } from "../contracts/output-fields.mjs";
import {
  nextAction,
  partActions,
  readerLength,
  STAGES,
  transition,
} from "../editorial/domain/index.mjs";
import { finalSteps, watchTimeline } from "./activity.mjs";
import { promptContext, summarizeInputs } from "./context.mjs";
import { judgeBatch } from "./figure-batch.mjs";
import {
  finalResultBlock,
  inlineFigureFiles,
  withoutFigureBodies,
  writeFigureInputs,
} from "./figure-files.mjs";
import { SessionReaper, sessionLabels } from "./lifecycle.mjs";
import { buildPrompt, formatRetryPrompt } from "./prompts/index.mjs";
import { resultEvent } from "./results.mjs";
import { sessionKeyOf } from "./roles.mjs";
import { RoleSessions } from "./sessions.mjs";
import { Workers } from "./workers.mjs";

// 요청당 상한 · 구간 초고 실측 96~116초(사고 토큰 포함) · 품질 위해 사고 단계 유지하고 시간 수용
// 가장 긴 단계(시각자료 생성)가 상한
const MAX_JOB_MS = FIGURE_LIMITS.generateMs;
// 결과가 편집 계약을 어긴 실패의 공통 사유 · 세부 원인은 diagnostic에만 남긴다
const CONTRACT_ERROR = "AI output did not satisfy the editorial contract; inspect Paseo session";
const PROVIDER_CACHE_MS = 60000;

const TERMINAL = ["completed", "failed"];
const summary = ({ id, agentId, status, deadline, deadlineStopAttempted }) => ({
  id,
  agentId,
  status,
  deadline,
  deadlineStopAttempted,
});

export class Jobs {
  #sessions;
  #reaper;
  // 끝나지 않은 작업 요약 색인 · 처음 한 번만 디스크를 훑고 이후 save가 갱신(감시 주기마다 전체 기록 재읽기 금지)
  #active = null;
  #expiring = false;
  // shortcut: 단일 브리지 프로세스의 작업 잠금 사용, 다중 인스턴스 운영 전 공유 저장소·원자적 잠금 전환
  constructor({ client, root, workRoot, allowedProviders = null, reuseProviders }) {
    Object.assign(this, { client, root, workRoot, allowedProviders });
    this.locks = new Map();
    const workers = new Workers(root);
    this.#sessions = new RoleSessions({
      client,
      workers,
      save: (job) => this.save(job),
      reuseProviders,
    });
    this.#reaper = new SessionReaper({
      client,
      workers,
      owner: resolve(root),
      workRoot,
      activeAgentIds: () => this.#activeAgentIds(),
    });
  }
  // 진행 중 작업의 세션은 정리 대상에서 뺀다
  async #activeAgentIds() {
    return [...(await this.#activeIndex()).values()].flatMap((job) =>
      job.agentId ? [job.agentId] : [],
    );
  }
  async #activeIndex() {
    if (!this.#active) {
      const found = new Map();
      for await (const job of this.#jobs())
        if (!TERMINAL.includes(job.status)) found.set(job.id, job);
      this.#active ??= found;
    }
    return this.#active;
  }
  // 기록마다 글 상태·SVG 전체를 담아 크므로 한 장씩 읽고 훑기에 필요한 칸만 남긴다(전체 동시 읽기는 메모리 고갈)
  async *#jobs() {
    let files;
    try {
      files = await readdir(this.root);
    } catch (e) {
      if (e.code === "ENOENT") return;
      throw e;
    }
    for (const file of files.filter((x) => /^[a-f0-9]{64}\.json$/.test(x))) {
      yield summary(await this.read(file.slice(0, -5)));
    }
  }
  /** 쓰지 않는 세션 정리 · all: 대기 담당까지 모두 내려놓음(런타임 종료 시) · ADR-0015 */
  sweepSessions(options) {
    return this.#reaper.sweep(options);
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
    if (this.#active)
      if (TERMINAL.includes(job.status)) this.#active.delete(job.id);
      else this.#active.set(job.id, summary(job));
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
    const head = await this.read(id);
    if (head.kind === "batch") {
      for (const child of head.parts) await this.stop(child);
      return this.#pollBatch(head);
    }
    return this.locked(id, async () => {
      const job = await this.read(id);
      if (["completed", "failed"].includes(job.status)) return job;
      await this.cancelAndConfirm(job);
      job.status = "failed";
      job.failureKind = "cancelled";
      // shortcut: 중단한 실행은 세션을 먼저 정리해 진행 기록을 보존하지 않음, 중단 단계 기록 요구가 생기면 정리 전 finalSteps 호출 검토
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
    // 묶음은 장마다 쓴 양·진행을 더해 한 작업으로 보인다
    if (job.kind === "batch") {
      const parts = await Promise.all(job.parts.map((child) => this.describe(child)));
      const usage = parts.some((part) => part.usage)
        ? Object.fromEntries(
            ["inputTokens", "cachedInputTokens", "outputTokens"].map((key) => [
              key,
              parts.reduce((sum, part) => sum + (part.usage?.[key] ?? 0), 0),
            ]),
          )
        : null;
      return {
        ...parts[0],
        status: job.status,
        failureKind: job.failureKind ?? null,
        output: null,
        usage,
        steps: parts.flatMap((part) => part.steps),
        figure: { id: job.action.figureIds.join(","), pass: job.action.pass },
      };
    }
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
                // 객체 배열은 기록용 항목만 · SVG 원문 등은 제외
                itemFields[key]
                  ? output[key].map((item) =>
                      Object.fromEntries(itemFields[key].map((field) => [field, item[field]])),
                    )
                  : output[key],
              ]),
          )
        : null,
      target: job.event?.target ?? null,
      reason: job.event?.reason ?? null,
      usage: job.usage ?? null,
      steps: job.steps ?? [],
      section: job.action.section
        ? { index: job.action.section.index, total: job.action.section.total }
        : null,
      // 시각자료는 그림·층마다 별도 작업 · 사용량 집계에서 재요청과 구분하는 키
      figure: job.action.figureId ? { id: job.action.figureId, pass: job.action.pass } : null,
      chars: typeof output?.text === "string" ? readerLength(output.text) : null,
    };
  }
  async watchActivity(id, emit) {
    let job = await this.read(id);
    // shortcut: 묶음은 첫 장의 진행만 보여 줌, 장별 진행 표시가 필요해지면 여러 구독을 합침
    if (job.kind === "batch") job = await this.read(job.parts[0]);
    if (!job.agentId) {
      emit({ phase: "waiting" });
      return () => {};
    }
    return watchTimeline(this.client.agents.ref(job.agentId), emit);
  }
  cancel(agentId) {
    return this.client.cancelAgent(agentId);
  }
  // 제공자 목록은 짧게 캐시 · 작업마다 구독을 열고 닫지 않음 · 로그인·한도 변화는 TTL 뒤 반영
  #providerCache = null;
  async providers() {
    const now = Date.now();
    if (!this.#providerCache || now - this.#providerCache.at > PROVIDER_CACHE_MS)
      this.#providerCache = {
        at: now,
        data: this.client.providers
          .waitForReady({ cwd: this.workRoot, timeoutMs: 15000 })
          .catch((error) => {
            this.#providerCache = null;
            throw error;
          }),
      };
    const data = await this.#providerCache.data;
    return data.entries
      .filter((x) => !this.allowedProviders || this.allowedProviders.includes(x.provider))
      .map((x) => ({
        provider: x.provider,
        status: x.status,
        models: x.models ?? [],
        ...(typeof x.defaultModeId === "string" ? { defaultModeId: x.defaultModeId } : {}),
      }));
  }
  async create({ state, ai: requested }) {
    // 저장된 이전 식별자(사고 단계를 붙인 모델 이름)도 현재 제공자 목록과 대조할 수 있게 바꾼다
    const ai = currentModel(requested);
    const action = nextAction(state);
    if (
      !Number.isSafeInteger(state.version) ||
      !Number.isSafeInteger(state.revision) ||
      state.revision < 1
    )
      throw new Error("Invalid editorial state");
    if (action.type === "request_ai" && !STAGES.includes(action.stage))
      throw new Error("Invalid stage");
    if (action.type === "request_figure" && !FIGURE_STAGES.includes(action.stage))
      throw new Error("Invalid stage");
    if (!["request_ai", "request_route", "request_figure"].includes(action.type))
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
    if (action.parts) return this.#createBatch(id, state, ai, action);
    return this.#createOne(id, state, ai, action);
  }
  // 그림 묶음: 그림마다 지금과 같은 한 장 작업을 동시에 만든다 · 묶음 작업은 결과를 모으기만 한다 · ADR-0026
  async #createBatch(id, state, ai, action) {
    const { parts: _parts, ...shared } = action;
    // 자식은 그림별 잠금이므로 동시에 띄운다 · 에이전트 기동(수십 초)을 그림 수만큼 기다리지 않음
    const children = await Promise.all(
      partActions(action).map((part) => {
        const childId = createHash("sha256")
          .update(JSON.stringify({ state, ai, figureId: part.figureId }))
          .digest("hex");
        return this.#createOne(childId, state, ai, part, id);
      }),
    );
    return this.locked(id, async () => {
      try {
        return await this.read(id);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      return this.save({
        id,
        kind: "batch",
        state,
        action: shared,
        ai,
        parts: children.map((child) => child.id),
        providerModel: children[0]?.providerModel,
        ...(children[0]?.labVariant ? { labVariant: children[0].labVariant } : {}),
        status: "running",
        createdAt: new Date().toISOString(),
      });
    });
  }
  async #createOne(id, state, ai, action, parentId) {
    return this.locked(`article:${state.articleId}:${action.figureId ?? ""}`, () =>
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
        if (!Number.isSafeInteger(duration) || duration < 1000 || duration > MAX_JOB_MS)
          throw new Error("Invalid job duration limit");
        const job = {
          id,
          agentId: randomUUID(),
          state,
          action: withoutFigureBodies(action),
          ai,
          deadline: Date.now() + duration,
          providerModel: `${ai.provider}/${model.id}`,
          // 연구소 실험이면 어느 변형으로 돌렸는지 남긴다 · 가져오기가 기록의 variant와 대조한다(LAB-001)
          ...(process.env.AIN_LAB_VARIANT ? { labVariant: process.env.AIN_LAB_VARIANT } : {}),
          // 모드 미지정이면 provider 기본(claude auto · codex auto-review) · 미전달 시 claude가 Always Ask로 떠 도구 작업이 멈춤
          ...((ai.mode ?? provider.defaultModeId)
            ? { modeId: ai.mode ?? provider.defaultModeId }
            : {}),
          status: "starting",
          createdAt: new Date().toISOString(),
          ...(parentId ? { parentId } : {}),
          inputSummary: summarizeInputs(promptContext(state, withoutFigureBodies(action))),
          ...(!ai.pilot && sessionKeyOf(action) ? { role: sessionKeyOf(action) } : {}),
        };
        await this.save(job);
        const cwd = join(this.workRoot, id);
        await mkdir(cwd, { recursive: true, mode: 0o700 });
        try {
          const promptAction = action.previous
            ? { ...action, previous: await writeFigureInputs(cwd, action.previous) }
            : action;
          const context = promptContext(state, promptAction);
          if ((await this.#sessions.acquire(job, context)).reused) {
            job.status = "running";
            return await this.save(job);
          }
          await this.#spawn(job, cwd, buildPrompt(state, promptAction, ai), context);
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
  // 새 세션 생성 · 첫 턴이라 역할·규칙 전체를 보낸다
  async #spawn(job, cwd, prompt, context) {
    const { state, action, ai } = job;
    const agent = await this.client.agents.create({
      idempotencyKey: `editorial-${job.id}${job.providerRetried ? "-retry" : ""}`,
      agentId: job.agentId,
      config: {
        provider: job.providerModel,
        ...(typeof ai.thinking === "string" ? { thinkingOptionId: ai.thinking } : {}),
        ...(job.modeId ? { modeId: job.modeId } : {}),
      },
      cwd,
      prompt,
      title: `블로그 ${action.stage ?? "피드백 라우팅"}${action.pass ? `·${action.pass}` : ""} r${state.revision} · ${typeof state.idea === "string" ? state.idea.split("\n")[0].slice(0, 50) : state.articleId}`,
      labels: sessionLabels(resolve(this.root), job.id),
      background: true,
    });
    job.agentId = agent.id;
    // 재시도 세션은 그사이 생긴 담당 세션을 덮지 않도록 재사용 등록하지 않는다
    if (!job.providerRetried) await this.#sessions.register(job, agent.id, context);
  }

  // 일시적 제공자 오류는 새 세션으로 한 번 다시 보낸다 · 오류 난 세션은 이어 쓸 수 없다
  // shortcut: 이전 시각자료 본문은 작업 파일에 남기지 않아 previous가 있는 작업은 재시도 제외, 재시도 실패가 반복되면 입력 보존 검토
  async #retryProvider(job, agent) {
    if (job.providerRetried || job.ai.pilot || job.action.previous || Date.now() >= job.deadline)
      return false;
    await this.#sessions.drop(job);
    try {
      await agent.archive();
    } catch {
      job.cleanupUnconfirmed = true;
    }
    job.providerRetried = true;
    delete job.workerBoundary;
    delete job.stepsAfter;
    delete job.reusedWorker;
    job.agentId = randomUUID();
    await this.#spawn(
      job,
      join(this.workRoot, job.id),
      buildPrompt(job.state, job.action, job.ai),
      null,
    );
    job.status = "running";
    return true;
  }

  // 그림 묶음: 장마다 확인하고 판정(judgeBatch)에 따라 기다림·실패·부분 결과를 저장 · ADR-0026
  async #pollBatch(head) {
    // 장마다 잠금이 따로라 동시에 확인한다
    const children = await Promise.all(head.parts.map((child) => this.poll(child)));
    return this.locked(head.id, async () => {
      const job = await this.read(head.id);
      if (["completed", "failed"].includes(job.status)) return job;
      const verdict = judgeBatch(children);
      if (verdict.kind === "wait") return job;
      if (verdict.kind === "settle") {
        job.status = verdict.from.status;
        job.error = verdict.from.error;
        if (verdict.from.failureKind) job.failureKind = verdict.from.failureKind;
        return this.save(job);
      }
      if (verdict.kind === "invalid") {
        job.status = "failed";
        job.failureKind = "invalid_output";
        job.error = CONTRACT_ERROR;
        return this.save(job);
      }
      const { figures, failed } = verdict;
      job.event = {
        id: `${job.id}-result`,
        actor: "adapter",
        expectedVersion: job.state.version,
        revision: job.state.revision,
        type: "figure_result",
        stage: job.action.stage,
        pass: job.action.pass,
        figureIds: job.action.figureIds,
        output: { figures },
        ...(failed.length ? { failed } : {}),
      };
      try {
        transition(job.state, job.event);
        job.status = "completed";
      } catch (error) {
        delete job.event;
        job.status = "failed";
        job.failureKind = "invalid_output";
        job.diagnostic = String(error?.message ?? error).slice(0, 600);
        job.error = CONTRACT_ERROR;
      }
      return this.save(job);
    });
  }
  // 감시 주기가 겹치지 않게 앞 회차가 끝나기 전에는 건너뛴다
  async expire() {
    if (this.#expiring) return;
    this.#expiring = true;
    try {
      await this.#expireActive();
    } finally {
      this.#expiring = false;
    }
  }
  async #expireActive() {
    for (const job of [...(await this.#activeIndex()).values()]) {
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
    const head = await this.read(id);
    if (head.kind === "batch") return this.#pollBatch(head);
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
        if (job.failureKind === "provider_error") {
          let retried = false;
          try {
            retried = await this.#retryProvider(job, agent);
          } catch {
            // 재시도 생성 실패는 원래 오류로 끝낸다
          }
          if (retried) {
            delete job.failureKind;
            return this.save(job);
          }
        }
        job.status = "failed";
        job.error =
          job.failureKind === "usage_limit"
            ? "Selected AI usage limit reached; no fallback performed"
            : job.failureKind === "authentication"
              ? "Selected AI login required"
              : "AI provider failed; inspect Paseo session";
      } else if (
        result.status === "idle" &&
        job.action.type === "request_figure" &&
        job.action.stage === "figure" &&
        finalResultBlock(result.lastMessage) === null &&
        Date.now() < job.deadline
      ) {
        // 시각자료 생성(도구 작업)만: codex는 진행 메모와 함께 잠깐 idle로 보일 수 있다 · 결과(JSON)가 올 때까지 진행 중으로 본다
        // shortcut: 끝내 JSON을 내지 않는 모델은 기한까지 기다린 뒤 시간 초과로 끝남, 제공자가 턴 종료 신호를 주면 그 신호로 교체
        job.status = "running";
        return job;
      } else if (result.status === "idle") {
        try {
          const message =
            job.action.type === "request_figure" && job.action.stage === "figure"
              ? await inlineFigureFiles(finalResultBlock(result.lastMessage), this.workRoot)
              : result.lastMessage;
          try {
            job.event = resultEvent(job, message);
          } catch (error) {
            // 형식 오류는 같은 세션에 한 번 다시 요청 · 세션이 내용을 기억해 비용이 적다
            if (job.formatRetried || job.ai.pilot) throw error;
            job.formatRetried = true;
            job.stepsAfter ??= job.workerBoundary?.seq ?? -1;
            await this.#sessions.followUp(job, agent, formatRetryPrompt(error));
            job.status = "running";
            return this.save(job);
          }
          // 묶음의 한 장은 묶음이 결과를 모은 뒤 함께 검사한다
          if (!job.parentId) transition(job.state, job.event);
          if (job.ai.pilot && job.event.output?.marker !== job.state.articleId)
            throw new Error("Pilot marker mismatch");
          job.usage = this.#sessions.turnUsage(job, agent, result);
          job.status = "completed";
        } catch (error) {
          delete job.event;
          job.status = "failed";
          job.failureKind = "invalid_output";
          // 어느 검사에서 막혔는지만 남긴다(응답 원문·경로는 남기지 않음)
          job.diagnostic = String(error?.message ?? error)
            .replace(/\/[^\s"']+/g, "[PATH]")
            .slice(0, 600);
          job.error = CONTRACT_ERROR;
        }
      } else {
        job.status = "needs_attention";
        job.error = "Unknown provider status";
      }
      if (["completed", "failed"].includes(job.status) && agent.timeline) {
        try {
          job.steps = await finalSteps(agent, job.stepsAfter ?? job.workerBoundary?.seq);
        } catch {
          // 기록 보존 실패는 편집 결과에 영향 없음 · 지도에서 '기록 없음'으로 보인다
        }
      }
      if (["failed", "needs_attention"].includes(job.status)) await this.#sessions.drop(job);
      if (["completed", "failed"].includes(job.status)) await this.#sessions.release(job, agent);
      return this.save(job);
    });
  }
}
