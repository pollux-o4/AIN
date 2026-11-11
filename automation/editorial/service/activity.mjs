import { flowIssue } from "../domain/index.mjs";
import { pendingState, stageName } from "../monitor.mjs";

// The editorial endpoint owns run/revision identity; the pipe only forwards snapshots.
export function observeActivity(service, id, emit) {
  let closed = false,
    identity,
    stopJob,
    generation = 0,
    latest = {},
    lastWire;
  const keyOf = (run) => `${run.state.revision}:${run.state.stage}:${run.pending?.jobId ?? ""}`;
  function publish(run) {
    if (closed) return;
    const active = pendingState(run.state) && !flowIssue(run.state) && !run.issue;
    if (active && run.pending?.jobId && !latest.phase) return;
    const stage = run.state.status === "waiting_route" ? "route" : run.state.stage;
    const phase = !active
      ? run.state.status === "paused"
        ? "paused"
        : run.issueKind === "ai_attention"
          ? "permission"
          : run.issue || flowIssue(run.state) || run.state.status === "failed"
            ? "failed"
            : "complete"
      : (latest.phase ?? "queued");
    const snapshot = {
      revision: run.state.revision,
      stage,
      name: stageName(stage),
      active,
      phase,
      text: latest.text ?? "",
      truncated: latest.truncated ?? false,
      lastOutputAt: latest.lastOutputAt ?? null,
    };
    const wire = JSON.stringify(snapshot);
    if (wire !== lastWire) {
      lastWire = wire;
      emit(snapshot);
    }
  }
  async function sync() {
    if (closed) return;
    const run = service.store.get(id);
    const key = keyOf(run);
    if (key !== identity) {
      identity = key;
      const current = ++generation;
      stopJob?.();
      stopJob = null;
      latest = {};
      if (run.pending?.jobId) {
        try {
          const stop = await service.jobs.watchActivity(run.pending.jobId, (activity) => {
            if (closed || current !== generation) return;
            const observed = service.store.get(id);
            if (keyOf(observed) !== key) return;
            // Observation failures retain the last received output.
            latest = { ...latest, ...activity };
            publish(observed);
          });
          if (closed || current !== generation) stop();
          else stopJob = stop;
        } catch {
          if (closed || current !== generation) return;
          latest = { phase: "unavailable" };
        }
      }
    }
    publish(service.store.get(id));
  }
  service.store.get(id); // Validate before opening an HTTP stream.
  void sync();
  const timer = setInterval(() => {
    void sync();
  }, 1000);
  return () => {
    closed = true;
    ++generation;
    clearInterval(timer);
    stopJob?.();
  };
}
