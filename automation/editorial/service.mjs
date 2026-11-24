import { randomUUID } from "node:crypto";
import { FIGURE_LIMITS } from "../contracts/figure.mjs";
import {
  advanceRequestSchema,
  createRequestSchema,
  requestObjectSchema,
} from "../contracts/requests.mjs";
import { isPendingStatus } from "../contracts/status.mjs";
import { DEFAULT_DIRECTION, directionSchema } from "../contracts/writing-modes.mjs";
import { coverageGap } from "./domain/figures.mjs";
import { continuesStage, flowIssue } from "./domain/index.mjs";
import { exportArticle, exportOptionsSchema } from "./export/index.mjs";
import {
  failureReason,
  pendingState as pending,
  recordEvent,
  runMonitor,
  stageName,
  workStage,
} from "./monitor.mjs";
import { failRun, runAction } from "./service/actions.mjs";
import { observeActivity } from "./service/activity.mjs";
import { aiFor, DEFAULT_AI } from "./service/ai-policy.mjs";
import { figureFile } from "./service/figures.mjs";
import { executionHistory } from "./service/history.mjs";
import {
  EDITORIAL_LIMITS,
  fail,
  resetBudget,
  runLimitMs,
  userTransition,
} from "./service/lifecycle.mjs";
import { completionNotice, displayedDraft, presented, runView, titleOf } from "./service/view.mjs";

export class EditorialService {
  constructor({ store, jobs, dispatch, ai = DEFAULT_AI, now = Date.now, figureRoutes = ["svg"] }) {
    // 연결된 그림 경로 · 실행 설정이라 상태에 저장하지 않는다(ADR-0025)
    Object.assign(this, {
      store,
      jobs,
      dispatch,
      ai,
      now,
      figureRoutes: Object.freeze([...figureRoutes]),
    });
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
    return runView(run, this.now(), this.figureRoutes);
  }
  // 목록 항목은 바뀐 글만 다시 읽는다(글 한 건이 수 MB) · 시간에 따라 표시가 바뀌는 대기 글은 매번 계산
  #listed = new Map();
  list() {
    const items = [];
    const live = new Set();
    for (const { id, updatedAt, archivedAt, status } of this.store.stamps()) {
      if (archivedAt) continue;
      live.add(id);
      let hit = this.#listed.get(id);
      if (!hit || hit.updatedAt !== updatedAt || isPendingStatus(status)) {
        hit = { updatedAt, item: this.#listItem(this.store.get(id)) };
        this.#listed.set(id, hit);
      }
      items.push(hit.item);
    }
    for (const id of this.#listed.keys()) if (!live.has(id)) this.#listed.delete(id);
    return items.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }
  #listItem(r) {
    return {
      id: r.id,
      title: titleOf(r),
      revision: r.state.revision,
      status: r.state.status,
      label: runMonitor(r, this.now()).label,
      needsCompletion: flowIssue(r.state) !== null,
      completionReason: completionNotice(r.state),
      updatedAt: r.updatedAt ?? null,
    };
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
  async resumePending() {
    const resumed = [];
    // 연결이 끊긴 글도 다시 잇는다 · 보완이 필요한 글은 거른다
    for (const { id } of this.store.pending()) {
      if (flowIssue(this.store.get(id).state)) continue;
      await this.connect(id);
      resumed.push(id);
    }
    return resumed;
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
        const sameStage = continuesStage(run.state);
        if (
          (!sameStage && run.callsUsed >= run.maxCalls) ||
          this.now() - run.startedAt > runLimitMs(run.state)
        ) {
          this.failure(
            run,
            "이번 요청의 실행 한도에 도달했습니다. 이어가기로 새 요청을 시작할 수 있습니다.",
          );
          return { id, continue: false };
        }
        if (!sameStage) run.callsUsed += 1;
        run.pending = {
          body: {
            state: run.state,
            ai: {
              ...run.ai,
              ...aiFor(run.state, run.ai),
              // 제한은 서버 현재 설정이 원천 · 작업 생성 시 저장된 값은 제한 변경 전 것일 수 있음
              maxDurationMs:
                run.state.figure?.phase === "generate"
                  ? FIGURE_LIMITS.generateMs
                  : this.ai.maxDurationMs,
              callsUsed: run.callsUsed,
              maxCalls: run.maxCalls,
              maxRunMs: runLimitMs(run.state),
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
          recordEvent(run, this.now(), "ai_requested", `${stageName(workStage(run.state))} 요청`, {
            jobId: job.id,
          });
          this.save(run);
        }
        const job = await this.jobs.poll(run.pending.jobId);
        if (job.status === "completed") {
          recordEvent(run, this.now(), "ai_completed", `${stageName(workStage(run.state))} 완료`, {
            jobId: job.id,
          });
          const revision = run.state.revision;
          run.state = userTransition(run.state, job.event);
          // 요구사항 가드가 새 회차를 열면 새 실행 예산 · ADR-0007
          if (run.state.revision > revision) {
            resetBudget(this, run);
            recordEvent(run, this.now(), "auto_correction", "요구사항 미충족 자동 재작성", {
              reason: run.state.feedback,
            });
          }
          // 단계 규칙(재시도 상한 등)으로 멈춘 실패도 기록에 남김 · 사용량 보기가 거부로 집계
          if (run.state.status === "failed")
            recordEvent(run, this.now(), "failed", "실패", { reason: run.state.error });
          if (run.state.status === "awaiting_user")
            recordEvent(run, this.now(), "ready", "초안 준비됨");
          if (run.state.status === "awaiting_brief")
            recordEvent(run, this.now(), "brief_ready", "수정 해석 확인 대기");
          // 준비됨 ≠ 확인됨: 사람의 선택·확인은 별도 기록 · FIGURE-001
          if (run.state.status === "awaiting_figure_choice") {
            const { coverage } = run.state.figure;
            recordEvent(run, this.now(), "figure_candidates_ready", "시각자료 위치 후보 준비됨", {
              reason: `후보 ${coverage?.candidates ?? run.state.figure.candidates.length}개`,
            });
            // 근본 개선 신호: 위치 제안이 단위를 빠뜨렸거나 후보가 한두 개뿐 · ADR-0017
            const gap = coverageGap(coverage);
            if (gap)
              recordEvent(run, this.now(), "figure_coverage_low", "시각자료 후보 부족", {
                reason: gap,
              });
          }
          if (run.state.status === "awaiting_figure_design")
            recordEvent(run, this.now(), "figure_design_ready", "시각자료 구성 준비됨 · 확인 대기");
          if (run.state.status === "awaiting_figure_review")
            recordEvent(run, this.now(), "figures_ready", "시각자료 준비됨 · 확인 대기");
          run.pending = null;
          this.save(run);
        } else if (job.status === "failed") {
          run.pending = null;
          // 어디서(단계)·왜(실패 종류)만 · 제공자 원문 오류는 LIVE-001에 따라 비노출
          const where = stageName(workStage(run.state));
          this.failure(run, `${where} 단계에서 멈춤 · ${failureReason(job.failureKind)}`);
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
  action(id, input, actor = "user") {
    return runAction(this, id, input, actor);
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
  restore(id) {
    return this.locked(id, async () => {
      const run = this.store.get(id);
      if (run.archivedAt) {
        delete run.archivedAt;
        recordEvent(run, this.now(), "restored", "목록에 복원");
        this.save(run);
      }
      return { id, archived: false };
    });
  }
  figure(id, figureId) {
    return figureFile(this.store.get(id), figureId);
  }
  // 내보내기: 지정 회차 본문 + 현재 회차에서 사람이 확인한 시각자료만 · 준비됨(확인 전)은 넣지 않음
  export(id, { revision, ...options } = {}) {
    const run = this.store.get(id),
      state = run.state;
    const target = Number(revision ?? displayedDraft(state).revision ?? state.revision);
    const current = target === state.revision && (presented(state) || flowIssue(state));
    const text = current
      ? state.artifacts?.draft?.output?.text
      : state.history?.find((h) => h.revision === target)?.artifacts?.draft?.output?.text;
    if (typeof text !== "string" || !text) fail("내보낼 초안이 아직 없습니다.", 409);
    const parsed = exportOptionsSchema.safeParse(options);
    if (!parsed.success) fail("내보내기 형식을 확인해 주세요.");
    const figures =
      current && state.figure?.phase === "confirmed" ? (state.figure.items ?? []) : [];
    return exportArticle(
      { id: run.id, title: titleOf(run), revision: target, text, figures },
      parsed.data,
    );
  }
  download(id, revision) {
    const file = this.export(id, { revision, format: "txt" });
    return { text: file.body, filename: file.filename };
  }
}
