import { randomUUID } from "node:crypto";
import {
  advanceRequestSchema,
  createRequestSchema,
  requestObjectSchema,
} from "../contracts/requests.mjs";
import { toTxt } from "../contracts/txt.mjs";
import { DEFAULT_DIRECTION, directionSchema } from "../contracts/writing-modes.mjs";
import { flowIssue } from "./domain/index.mjs";
import { pendingState as pending, recordEvent, runMonitor, stageName } from "./monitor.mjs";
import { failRun, runAction } from "./service/actions.mjs";
import { observeActivity } from "./service/activity.mjs";
import { executionHistory } from "./service/history.mjs";
import { DEFAULT_AI, EDITORIAL_LIMITS, fail, userTransition } from "./service/lifecycle.mjs";
import { completionNotice, displayedDraft, presented, runView, titleOf } from "./service/view.mjs";

export class EditorialService {
  constructor({ store, jobs, dispatch, ai = DEFAULT_AI, now = Date.now }) {
    Object.assign(this, { store, jobs, dispatch, ai, now });
    // shortcut: 로컬 단일 서비스의 작업별 잠금, 다중 프로세스 운영 전 DB 기반 실행 lease 도입
    this.locks = new Map();
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
  save(run) {
    run.updatedAt = this.now();
    return this.store.save(run);
  }
  view(run) {
    return runView(run, this.now());
  }
  list() {
    return this.store
      .list()
      .filter((r) => !r.archivedAt)
      .map((r) => ({
        id: r.id,
        title: titleOf(r),
        revision: r.state.revision,
        status: r.state.status,
        label: runMonitor(r, this.now()).label,
        needsCompletion: flowIssue(r.state) !== null,
        completionReason: completionNotice(r.state),
      }));
  }
  get(id) {
    return this.view(this.store.get(id));
  }
  history(id) {
    return executionHistory(this, id);
  }
  observeActivity(id, emit) {
    return observeActivity(this, id, emit);
  }
  async connect(id) {
    const state = this.store.get(id).state;
    if (flowIssue(state) || !pending(state)) return this.get(id);
    try {
      await this.dispatch(id);
    } catch {
      await this.locked(id, async () => {
        const run = this.store.get(id);
        if (!flowIssue(run.state) && pending(run.state)) {
          run.issue = "진행 연결이 끊겼습니다. 상태 다시 확인을 눌러 주세요.";
          run.issueKind = "connection";
          recordEvent(run, this.now(), "connection_lost", "진행 연결 실패");
          this.save(run);
        }
      });
    }
    return this.get(id);
  }
  async create(input) {
    if (!requestObjectSchema.safeParse(input).success) fail("글감을 입력해 주세요.");
    const { requestId, idea, source = "" } = input;
    if (!createRequestSchema.safeParse(input).success)
      fail("글감과 참고 자료의 길이를 확인해 주세요.");
    const direction = directionSchema.parse(input.direction ?? DEFAULT_DIRECTION);
    const id = await this.locked("create", async () => {
      const existing = this.store.find(requestId);
      if (existing) {
        const previousDirection = existing.state.direction ?? DEFAULT_DIRECTION;
        if (
          existing.state.idea !== idea.trim() ||
          existing.state.source !== source ||
          previousDirection.mode !== direction.mode ||
          previousDirection.readerLevel !== direction.readerLevel
        )
          fail("같은 제출 번호의 입력이 달라졌습니다.", 409);
        return existing.id;
      }
      const id = randomUUID();
      const state = userTransition(null, {
        id: requestId,
        actor: "user",
        type: "start",
        articleId: id,
        idea: idea.trim(),
        source,
        direction,
        plan: input.plan,
      });
      const run = {
        id,
        requestId,
        state,
        ai: { ...this.ai },
        callsUsed: 0,
        maxCalls: EDITORIAL_LIMITS.initialCalls,
        startedAt: this.now(),
        operations: {},
        issue: null,
        pending: null,
        queuedAt: this.now(),
        worker: null,
      };
      recordEvent(run, this.now(), "requested", "글 생성 요청");
      this.save(run);
      return id;
    });
    return this.connect(id);
  }
  failure(run, message) {
    return failRun(this, run, message);
  }
  async advance(id, context = {}) {
    if (!requestObjectSchema.safeParse(context).success) fail("실행 정보를 확인해 주세요.");
    return this.locked(id, async () => {
      const run = this.store.get(id);
      if (!advanceRequestSchema.safeParse(context).success) fail("실행 식별자를 확인해 주세요.");
      if (flowIssue(run.state)) return { id, continue: false };
      const newExecution =
        context.executionId &&
        !(run.events ?? []).some((event) => event.executionId === context.executionId);
      run.worker = {
        ...run.worker,
        confirmedAt: this.now(),
        ...(context.executionId ? { executionId: context.executionId } : {}),
      };
      if (newExecution) recordEvent(run, this.now(), "connected", "실행 연결");
      this.save(run);
      if (!pending(run.state) || run.issue) return { id, continue: false };
      if (!run.pending) {
        if (
          run.callsUsed >= run.maxCalls ||
          this.now() - run.startedAt > EDITORIAL_LIMITS.maxRunMs
        ) {
          this.failure(
            run,
            "이번 요청의 실행 한도에 도달했습니다. 이어가기로 새 요청을 시작할 수 있습니다.",
          );
          return { id, continue: false };
        }
        run.callsUsed += 1;
        run.pending = {
          body: {
            state: run.state,
            ai: {
              ...run.ai,
              callsUsed: run.callsUsed,
              maxCalls: run.maxCalls,
              maxRunMs: EDITORIAL_LIMITS.maxRunMs,
              startedAt: run.startedAt,
            },
          },
        };
        this.save(run);
      }
      try {
        if (!run.pending.jobId) {
          const job = await this.jobs.create(run.pending.body);
          run.pending.jobId = job.id;
          recordEvent(
            run,
            this.now(),
            "ai_requested",
            `${stageName(run.state.status === "waiting_route" ? "route" : run.state.stage)} 요청`,
            { jobId: job.id },
          );
          this.save(run);
        }
        const job = await this.jobs.poll(run.pending.jobId);
        if (job.status === "completed") {
          recordEvent(
            run,
            this.now(),
            "ai_completed",
            `${stageName(run.state.status === "waiting_route" ? "route" : run.state.stage)} 완료`,
            { jobId: job.id },
          );
          run.state = userTransition(run.state, job.event);
          if (run.state.status === "awaiting_user")
            recordEvent(run, this.now(), "ready", "초안 준비됨");
          run.pending = null;
          this.save(run);
        } else if (job.status === "failed") {
          run.pending = null;
          this.failure(
            run,
            job.failureKind === "usage_limit"
              ? "AI 사용 한도에 도달했습니다. 한도 회복 후 이어가기를 눌러 주세요."
              : "AI 작업을 완료하지 못했습니다. 이어가기로 다시 시도해 주세요.",
          );
        } else if (["permission", "needs_attention"].includes(job.status)) {
          run.issue =
            "AI 실행에 확인이 필요합니다. 실행 기록에서 확인 후 상태 다시 확인을 눌러 주세요.";
          run.issueKind = "ai_attention";
          recordEvent(run, this.now(), "attention", "AI 확인 필요", { jobId: job.id });
          this.save(run);
        } else {
          this.save(run);
        }
      } catch (error) {
        if (error.status) throw error;
        // 생성 결과가 불명확하면 같은 pending 요청으로 재확인; 새 AI 작업 생성 금지.
        run.issue = "AI 연결을 확인하지 못했습니다. 상태 다시 확인을 눌러 주세요.";
        run.issueKind = "ai_connection";
        recordEvent(run, this.now(), "connection_lost", "AI 상태 확인 실패");
        this.save(run);
      }
      return { id, continue: pending(run.state) && !run.issue };
    });
  }
  action(id, input) {
    return runAction(this, id, input);
  }
  // shortcut: 목록에서만 숨기고 원고·이력·AI 작업 파일은 보존, 저장 용량 문제가 생기면 영구 삭제·파일 정리 추가
  archive(id) {
    return this.locked(id, async () => {
      const run = this.store.get(id);
      if (pending(run.state)) fail("진행 중인 작업은 먼저 중단해 주세요.", 409);
      if (!run.archivedAt) {
        run.archivedAt = this.now();
        recordEvent(run, this.now(), "archived", "목록에서 삭제");
        this.save(run);
      }
      return { id, archived: true };
    });
  }
  download(id, revision) {
    const run = this.store.get(id),
      state = run.state;
    const target = Number(revision ?? displayedDraft(state).revision ?? state.revision);
    const text =
      target === state.revision && (presented(state) || flowIssue(state))
        ? state.artifacts?.draft?.output?.text
        : state.history?.find((h) => h.revision === target)?.artifacts?.draft?.output?.text;
    if (typeof text !== "string" || !text) fail("다운로드할 초안이 아직 없습니다.", 409);
    return {
      text: toTxt(text),
      filename: `article-${run.id}-r${target}.txt`,
    };
  }
}
