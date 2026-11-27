import { fork } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { arch, cpus, platform, release, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { completionClock, completionDelayMs, idea } from "./fixture.mjs";
import { memorySnapshot } from "./process-metrics.mjs";

const numeric = (value, label, min, max) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max)
    throw new Error(`Invalid ${label}: expected ${min}–${max}`);
  return parsed;
};
const { values } = parseArgs({
  options: {
    adapter: { type: "string" },
    browser: { type: "boolean" },
    runs: { type: "string", default: "3" },
    "n8n-port": { type: "string", default: "5738" },
    "history-count": { type: "string", default: "250" },
    "history-bytes": { type: "string", default: "131072" },
  },
});
const trials = numeric(values.runs, "runs", 1, 20);
const n8nPort = numeric(values["n8n-port"], "n8n-port", 1024, 65534);
const historyCount = numeric(values["history-count"], "history-count", 1, 5000);
const historyBytes = numeric(values["history-bytes"], "history-bytes", 1024, 4194304);
if (historyCount * historyBytes > 1024 ** 3) throw new Error("History fixture exceeds 1 GiB");
const adapterPath = values.adapter
  ? pathToFileURL(resolve(values.adapter)).href
  : new URL("./node-runtime.mjs", import.meta.url).href;
const pollMs = 25;
const sampleMs = 500;
const groupConcurrency = 4;

function connectAdapter() {
  const child = fork(fileURLToPath(new URL("./adapter-process.mjs", import.meta.url)), {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      AIN_FIGURE_AI_PLAN: "fixture/fixture-model",
      AIN_FIGURE_AI_DRAW: "fixture/fixture-model",
      AIN_FIGURE_AI_FIX: "fixture/fixture-model",
    },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  let sequence = 0;
  const pending = new Map();
  child.on("message", ({ id, error, value }) => {
    const call = pending.get(id);
    if (!call) return;
    pending.delete(id);
    if (error) call.reject(new Error(`Adapter ${call.operation}: ${error}`));
    else call.resolve(value);
  });
  function fail(error) {
    for (const call of pending.values()) call.reject(error);
    pending.clear();
  }
  child.on("error", fail);
  const closed = new Promise((resolve) =>
    child.once("close", (code) => {
      fail(new Error(`Adapter exited (${code ?? "signal"})`));
      resolve();
    }),
  );
  function call(operation, argument) {
    return new Promise((resolve, reject) => {
      if (!child.connected) return reject(new Error("Adapter disconnected"));
      const id = ++sequence;
      pending.set(id, { operation, resolve, reject });
      child.send({ id, operation, argument }, (error) => {
        if (!error) return;
        pending.delete(id);
        reject(error);
      });
    });
  }
  async function close() {
    const deadline = setTimeout(() => child.kill("SIGTERM"), 8000);
    const force = setTimeout(() => child.kill("SIGKILL"), 16000);
    try {
      if (child.connected) await call("stop");
    } finally {
      await closed;
      clearTimeout(deadline);
      clearTimeout(force);
    }
  }
  return { call, close };
}

const round = (value) => Number(value.toFixed(2));
function percentiles(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p) =>
    sorted.length ? round(sorted[Math.ceil(sorted.length * p) - 1]) : null;
  return { n: sorted.length, p50: percentile(0.5), p95: percentile(0.95) };
}

async function trial(root, iteration) {
  const adapter = connectAdapter();
  try {
    const backend = await adapter.call("start", {
      path: adapterPath,
      config: { root, n8nPort, historyCount, historyBytes, logLevel: "error", completionDelayMs },
    });
    const origin = new URL(backend.url);
    if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1")
      throw new Error("Adapter must bind an isolated loopback HTTP port");
    if (backend.diagnostics.logLevel !== "error")
      throw new Error("Adapter log level must be error");
    const session = await fetch(new URL("/write/session", origin), {
      signal: AbortSignal.timeout(5000),
    });
    const cookie = session.headers.getSetCookie()[0]?.split(";")[0];
    if (session.status !== 204 || !cookie) throw new Error("Fixture UI session unavailable");
    async function request(path, body, signal) {
      const response = await fetch(new URL(`/write/api/runs${path}`, origin), {
        method: body ? "POST" : "GET",
        headers: {
          cookie,
          ...(body ? { Origin: origin.origin } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
          : AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        const diagnostic = await response.json().catch(() => null);
        throw new Error(
          `Fixture API ${response.status} for ${body?.type ?? path}: ${diagnostic?.error ?? "unknown"}`,
        );
      }
      return response.json();
    }
    const observed = new Map();
    let browserRenderMs = null;
    const callsByPhase = new Map();
    const phases = {};
    function track(view, phase) {
      for (const event of view.monitor?.events ?? []) {
        if (event.kind !== "ai_completed" || observed.has(event.jobId)) continue;
        observed.set(event.jobId, completionClock());
        callsByPhase.get(phase).add(event.jobId);
      }
    }
    async function wait(id, status, phase) {
      const budget = AbortSignal.timeout(90000);
      while (!budget.aborted) {
        const view = await request(`/${id}`, undefined, budget);
        track(view, phase);
        if (view.status === status) return view;
        if (view.issue || view.status === "failed")
          throw new Error(
            `Fixture stopped at ${view.stage} (${view.status}): ${view.issue ?? "failed"}`,
          );
        await delay(pollMs);
      }
      throw new Error(`Fixture did not reach ${status}`);
    }
    const create = (key) => request("", { requestId: `perf-${iteration}-${key}`, idea });
    const action = (view, type, extra = {}) =>
      request(`/${view.id}/actions`, {
        operationId: `perf-${type}-${view.version}`,
        expectedVersion: view.version,
        type,
        ...extra,
      });
    const sample = async () => ({
      memory: await memorySnapshot(backend.pid, backend.runtime, backend.extraRoots),
      counts: await adapter.call("counts"),
    });
    async function phase(name, run) {
      callsByPhase.set(name, new Set());
      const samples = [];
      const done = new AbortController();
      let samplingError;
      const sampling = (async () => {
        do {
          samples.push(await sample());
          await delay(sampleMs, undefined, { signal: done.signal });
        } while (!done.signal.aborted);
      })().catch((error) => {
        if (error.name !== "AbortError") samplingError = error;
      });
      const started = performance.now();
      let result;
      try {
        result = await run(name);
      } finally {
        done.abort();
        await sampling;
      }
      if (samplingError) throw samplingError;
      const max = (selector) => {
        const numbers = samples.map(selector).filter(Number.isFinite);
        return numbers.length ? Math.max(...numbers) : null;
      };
      const peak = samples.reduce(
        (highest, sample) =>
          sample.memory.total.rssKiB > highest.memory.total.rssKiB ? sample : highest,
        samples[0],
      );
      phases[name] = {
        wallMs: round(performance.now() - started),
        memorySamples: samples.length,
        peak,
        maxCounts: Object.fromEntries(
          Object.keys(peak.counts).map((key) => [key, max((sample) => sample.counts[key])]),
        ),
      };
      return result;
    }
    const idle = await sample();
    if (!idle.memory.groups.ain.rssKiB) throw new Error("Runtime process unavailable in /proc");
    if (
      backend.runtime === "node+n8n" &&
      !idle.memory.processes.some((process) => process.role === "n8n")
    )
      throw new Error("Isolated n8n process unavailable in /proc");
    const single = await phase("single", async (name) => {
      const { id } = await create("single");
      const setup = values.browser ? await import("./browser.mjs") : null;
      const observe = setup
        ? setup.observeBrowser(origin, id).then(
            (value) => ({ value }),
            (error) => ({ error }),
          )
        : null;
      const view = await wait(id, "awaiting_user", name);
      if (observe) {
        const { error, value } = await observe;
        if (error) throw error;
        browserRenderMs = value;
      }
      return view;
    });
    if (values.browser)
      return { runtime: backend.runtime, diagnostics: backend.diagnostics, browserRenderMs };
    const afterSingle = await sample();
    await phase("concurrent", async (name) => {
      const drafts = Promise.all(
        Array.from({ length: groupConcurrency }, async (_, index) => {
          const { id } = await create(`parallel-${index}`);
          return wait(id, "awaiting_user", name);
        }),
      );
      const figures = (async () => {
        let view = await action(single, "satisfy");
        await action(view, "request_figures");
        view = await wait(view.id, "awaiting_figure_choice", name);
        await action(view, "select_figures", { figures: ["f1", "f2"] });
        view = await wait(view.id, "awaiting_figure_design", name);
        await action(view, "approve_design");
        view = await wait(view.id, "awaiting_figure_review", name);
        await action(view, "confirm_figures");
      })();
      const results = await Promise.allSettled([drafts, figures]);
      for (const result of results) if (result.status === "rejected") throw result.reason;
    });
    const beforeCleanup = await sample();
    const cleanup = await adapter.call("clean");
    const afterCleanup = await sample();

    const history = await phase("recovered", async (name) => {
      const recovery = await adapter.call("seedAndRecover", single.id);
      await Promise.all(recovery.ids.map((id) => wait(id, "awaiting_user", name)));
      return recovery;
    });
    const listMs = [];
    for (let index = 0; index < 6; index++) {
      const start = performance.now();
      const { runs } = await request("");
      listMs.push(performance.now() - start);
      if (runs.length !== historyCount + 9)
        throw new Error("History list count differs from fixture");
    }
    const historyCleanup = await adapter.call("clean");
    const afterRecoveryCleanup = await sample();
    for (const { counts } of [afterCleanup, afterRecoveryCleanup]) {
      if (counts.runningSessions !== 0 || counts.idleSessions !== 0 || counts.subscriptions !== 0)
        throw new Error("Synthetic sessions or subscriptions remained after full cleanup");
    }
    const traces = await adapter.call("traces");
    const samples = {};
    for (const [name, jobIds] of callsByPhase) {
      if (!jobIds.size) throw new Error(`No API-observed completions for ${name}`);
      samples[name] = [...jobIds].map((id) => {
        const trace = traces[id];
        if (!trace || ![trace.signal, trace.checked, trace.saved].every(Number.isFinite))
          throw new Error(`Missing boundary trace for ${name}`);
        const { signal, checked, saved } = trace;
        const api = observed.get(id);
        if (checked < signal || saved < checked || api < saved)
          throw new Error(`Non-monotonic completion trace for ${name}`);
        return [checked - signal, saved - checked, api - saved, saved - signal];
      });
    }
    return {
      runtime: backend.runtime,
      diagnostics: backend.diagnostics,
      idle,
      afterSingle,
      beforeCleanup,
      cleanup,
      afterCleanup,
      historyCleanup,
      afterRecoveryCleanup,
      phases,
      samples,
      history: { databaseBytes: history.databaseBytes, recoveryMs: history.recoveryMs, listMs },
    };
  } finally {
    await adapter.close();
  }
}

const scratch = await mkdtemp(join(tmpdir(), "ain-mig-051-"));
try {
  const results = [];
  for (let index = 0; index < trials; index++) {
    const root = join(scratch, String(index));
    await mkdir(root);
    results.push(await trial(root, index));
  }
  const { runtime, diagnostics } = results[0];
  const host = {
    platform: platform(),
    arch: arch(),
    kernel: release(),
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    memoryBytes: totalmem(),
    node: process.version,
  };
  if (values.browser) {
    console.log(
      JSON.stringify(
        {
          schema: 1,
          runtime,
          diagnostics,
          host,
          workload: { trials, completionDelayMs, browser: true },
          browserRenderMs: percentiles(results.map((result) => result.browserRenderMs)),
        },
        null,
        2,
      ),
    );
  } else {
    const latencyMs = Object.fromEntries(
      Object.keys(results[0].samples).map((phase) => {
        const rows = results.flatMap((result) => result.samples[phase]);
        const boundaries = ["signalToCheck", "checkToSave", "saveToApi", "signalToSave"];
        return [
          phase,
          Object.fromEntries(
            boundaries.map((key, index) => [key, percentiles(rows.map((row) => row[index]))]),
          ),
        ];
      }),
    );
    console.log(
      JSON.stringify(
        {
          schema: 1,
          runtime,
          diagnostics,
          host,
          workload: {
            trials,
            historyCount,
            historyBytes,
            groupConcurrency,
            figures: 2,
            completionDelayMs,
            pollMs,
            sampleMs,
          },
          latencyMs,
          historyMs: {
            coldList: percentiles(results.map((result) => result.history.listMs[0])),
            warmList: percentiles(results.flatMap((result) => result.history.listMs.slice(1))),
            restartDispatch: percentiles(results.map((result) => result.history.recoveryMs)),
          },
          browserRenderMs: null,
          trials: results.map(({ samples, ...rest }) => rest),
        },
        null,
        2,
      ),
    );
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
