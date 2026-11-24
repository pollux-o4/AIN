import { FIGURE_LIMITS, FIGURE_PASSES } from "../../contracts/figure.mjs";
import { RUNTIME_PROTOCOL } from "../../contracts/runtime.mjs";

const POLL_INTERVAL_MS = 1500;

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function createHttpSession(baseUrl) {
  const origin = new URL(baseUrl).origin;
  const health = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(3000) });
  if (!health.ok) throw new Error(`편집 서버 상태 확인 실패 (${health.status})`);
  const info = await health.json();
  if (info.protocol !== RUNTIME_PROTOCOL)
    throw new Error(`편집 서버 프로토콜 불일치: ${info.protocol} !== ${RUNTIME_PROTOCOL}`);

  const session = await fetch(`${origin}/write/session`, { signal: AbortSignal.timeout(3000) });
  if (!session.ok) throw new Error(`글쓰기 세션 시작 실패 (${session.status})`);
  const cookie = session.headers.getSetCookie()[0]?.split(";")[0];
  if (!cookie) throw new Error("세션 쿠키를 받지 못했습니다.");

  async function request(path, { body, raw = false } = {}) {
    const response = await fetch(`${origin}/write/api/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie,
        ...(body === undefined ? {} : { origin, "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`${path} 실패 (${response.status}): ${error.error ?? "unknown"}`);
    }
    return raw ? response.text() : response.json();
  }
  return { request };
}

async function waitForStatus(http, articleId, wanted, { timeoutMs, signal, stage }) {
  const deadline = Date.now() + timeoutMs;
  let view = await http.request(`runs/${articleId}`);
  while (view.status !== wanted) {
    signal?.throwIfAborted();
    if (view.issue) throw new Error(`${stage} 중단: ${view.issue}`);
    if (view.status === "failed") throw new Error(`${stage} 실패`);
    if (Date.now() >= deadline) throw new Error(`${stage} 시간 초과`);
    await delay(POLL_INTERVAL_MS, signal);
    view = await http.request(`runs/${articleId}`);
  }
  return view;
}

const select = (http, articleId, view, figures, look) =>
  http.request(`runs/${articleId}/actions`, {
    body: {
      operationId: `lab-select-${articleId}`,
      expectedVersion: view.version,
      type: "select_figures",
      figures,
      ...(look ? { look } : {}),
    },
  });

/**
 * 연구소 한 회차를 진행한다 · ADR-0026
 * - plan: 확정 초안에서 위치 선정까지
 * - compose: 위치 후보 상태에서 고른 자리를 구성까지
 * - figure: compose 뒤 구성을 승인하고 그림 생성까지
 */
export async function drive({ http, articleId, stage = "plan", figures = [], look, signal }) {
  let view = await http.request(`runs/${articleId}`);
  if (stage === "plan") {
    if (view.status !== "satisfied" || !view.canRequestFigures)
      throw new Error("시드 실행이 시각자료 위치 제안을 시작할 수 없는 상태입니다.");
    view = await http.request(`runs/${articleId}/actions`, {
      body: {
        operationId: `lab-plan-${articleId}`,
        expectedVersion: view.version,
        type: "request_figures",
      },
    });
    view = await waitForStatus(http, articleId, "awaiting_figure_choice", {
      timeoutMs: FIGURE_LIMITS.generateMs,
      signal,
      stage: "위치 제안",
    });
    return { articleId, figure: view.figure };
  }
  if (view.status !== "awaiting_figure_choice" || !view.canSelectFigures)
    throw new Error("시드 실행이 위치 후보 선택 상태가 아닙니다.");
  const ids = view.figure.candidates.map((candidate) => candidate.id);
  if (!figures.length || !figures.every((id) => ids.includes(id)))
    throw new Error(`위치 후보에서 그림 자리를 찾지 못했습니다: ${figures.join(",") || "(없음)"}`);
  await select(http, articleId, view, figures, look);
  view = await waitForStatus(http, articleId, "awaiting_figure_design", {
    timeoutMs: FIGURE_LIMITS.generateMs,
    signal,
    stage: "구성",
  });
  if (stage === "compose") return { articleId, figure: view.figure };
  await http.request(`runs/${articleId}/actions`, {
    body: {
      operationId: `lab-approve-${articleId}`,
      expectedVersion: view.version,
      type: "approve_design",
    },
  });
  view = await waitForStatus(http, articleId, "awaiting_figure_review", {
    timeoutMs: FIGURE_LIMITS.generateMs * FIGURE_PASSES.length * figures.length,
    signal,
    stage: "그림 생성",
  });
  return { articleId, figure: view.figure };
}

/** 확인 대기 그림 하나에 지적을 보내 국소 수정 한 번 · ADR-0026 */
export async function fix({ http, articleId, figure, feedback, signal }) {
  const view = await http.request(`runs/${articleId}`);
  if (view.status !== "awaiting_figure_review" || !view.canReviseFigures)
    throw new Error("수정할 그림이 확인 대기 상태가 아닙니다.");
  await http.request(`runs/${articleId}/actions`, {
    body: {
      operationId: `lab-fix-${articleId}-${view.version}`,
      expectedVersion: view.version,
      type: "revise_figures",
      target: "fix",
      figures: [figure],
      feedback,
    },
  });
  const done = await waitForStatus(http, articleId, "awaiting_figure_review", {
    timeoutMs: FIGURE_LIMITS.generateMs,
    signal,
    stage: "그림 수정",
  });
  return { articleId, figure: done.figure };
}
