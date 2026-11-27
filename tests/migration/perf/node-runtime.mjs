import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import {
  EditorialService,
  EditorialStore,
  editorialHttp,
} from "../../../automation/editorial/index.mjs";
import { WAIT_SECONDS } from "../../../automation/n8n/build-editorial-workflow.mjs";
import { startIsolatedN8n } from "../../../automation/n8n/testing/runtime.mjs";
import { Jobs } from "../../../automation/paseo/index.mjs";
import { completionClock, idea, model, provider, syntheticClient } from "./fixture.mjs";

export async function start({ root, n8nPort, historyCount, historyBytes }) {
  const token = randomBytes(32).toString("hex");
  const n8nUrl = `http://127.0.0.1:${n8nPort}`;
  const database = join(root, "editorial.sqlite");
  const fixture = syntheticClient();
  const traces = new Map();
  const jobs = new Jobs({
    client: fixture.client,
    root: join(root, "jobs"),
    workRoot: join(root, "work"),
  });
  const poll = jobs.poll.bind(jobs);
  jobs.poll = async (id) => {
    const job = await poll(id);
    if (job.status === "completed" && !traces.has(id)) {
      const times = job.parts
        ? job.parts.map((part) => traces.get(part))
        : [fixture.timing(job.agentId)];
      traces.set(id, {
        signal: Math.max(...times.map(({ signal }) => signal)),
        checked: Math.max(...times.map(({ checked }) => checked)),
      });
    }
    return job;
  };
  let runtime;
  let service;
  let store;
  let route;
  const ai = { provider, model, enabled: true, maxDurationMs: 120000 };
  const dispatch = (id) => runtime.dispatch(id);
  function bind() {
    store = new EditorialStore(database);
    const save = store.save.bind(store);
    store.save = (run) => {
      const saved = save(run);
      const latest = run.events?.at(-1);
      const finished =
        latest?.kind === "ai_completed"
          ? latest
          : run.events?.findLast((event) => event.kind === "ai_completed");
      const trace = finished && traces.get(finished.jobId);
      if (trace && !run.pending) trace.saved ??= completionClock();
      return saved;
    };
    service = new EditorialService({ store, jobs, ai, dispatch });
    route = editorialHttp({ service, token, n8nUrl });
  }
  const server = createServer(async (req, res) => {
    if (!(await route(req, res))) res.writeHead(404).end();
  });
  bind();
  let stopping;
  function stop() {
    stopping ??= (async () => {
      await runtime?.stop();
      const closed = new Promise((done) => server.close(done));
      server.closeAllConnections();
      await closed;
      store.close();
    })();
    return stopping;
  }
  try {
    await new Promise((done, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", done);
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    const n8nRoot = join(root, "n8n");
    await mkdir(n8nRoot, { mode: 0o700 });
    runtime = await startIsolatedN8n({ root: n8nRoot, port: n8nPort, bridgeUrl: url, token });
    return {
      url,
      pid: process.pid,
      runtime: "node+n8n",
      diagnostics: { logLevel: "error", n8nWaitSeconds: WAIT_SECONDS },
      counts: fixture.counts,
      traces: () => Object.fromEntries([...traces].filter(([, trace]) => trace.saved)),
      clean: () => jobs.sweepSessions({ all: true }),
      async seedAndRecover(completedId) {
        const original = store.get(completedId);
        const history = Array.from({ length: 8 }, (_, index) => ({
          revision: index + 1,
          artifacts: {
            draft: {
              revision: index + 1,
              output: {
                text: `# 합성 이력 ${index + 1}\n\n${"x".repeat(Math.floor(historyBytes / 8))}`,
              },
            },
          },
        }));
        for (let index = 0; index < historyCount; index++) {
          const id = randomUUID();
          store.save({
            ...original,
            id,
            requestId: `perf-history-${index}`,
            state: { ...original.state, articleId: id, history },
          });
        }
        const offline = new EditorialService({ store, jobs, ai, dispatch: () => {} });
        const queued = [];
        for (let index = 0; index < 4; index++)
          queued.push((await offline.create({ requestId: `perf-recovery-${index}`, idea })).id);
        store.close();
        const bytes = (await stat(database)).size;
        const begin = completionClock();
        bind();
        const resumed = await service.resumePending();
        if (resumed.length !== queued.length || queued.some((id) => !resumed.includes(id)))
          throw new Error("Synthetic restart did not dispatch all four seeded pending articles");
        return { recoveryMs: completionClock() - begin, databaseBytes: bytes, ids: queued };
      },
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
