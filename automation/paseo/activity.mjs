import { ACTIVITY_TEXT_LIMIT } from "../contracts/activity.mjs";

// Observation only: never runs, polls for completion, or mutates an AI job.
export function timelineActivity(page) {
  if (page.error) throw new Error("Timeline unavailable");
  const entries = page.entries ?? [];
  // shortcut: 공개 응답 이벤트가 없는 구간은 응답 대기만 표시, 제공자가 세부 진행 이벤트를 지원하면 확장
  const messages = entries.filter((entry) => entry.item.type === "assistant_message");
  const text = messages.map((entry) => entry.item.text).join("\n\n");
  const latest = entries.findLast((entry) =>
    ["assistant_message", "tool_call"].includes(entry.item.type),
  );
  const status = page.agent?.status;
  const phase =
    status === "error"
      ? "failed"
      : page.agent?.pendingPermissions?.length
        ? "permission"
        : status === "idle"
          ? "validating"
          : latest?.item.type === "tool_call" && latest.item.status === "running"
            ? "tool"
            : text
              ? "generating"
              : "waiting";
  return {
    phase,
    text: text.slice(0, ACTIVITY_TEXT_LIMIT),
    truncated: text.length > ACTIVITY_TEXT_LIMIT || Boolean(page.hasOlder),
    lastOutputAt: messages.length ? Date.parse(messages.at(-1).timestamp) || null : null,
  };
}

export function watchTimeline(agent, emit) {
  let closed = false,
    fetching = false,
    dirty = false,
    timer,
    retry,
    unsubscribe;
  const unavailable = () => {
    if (closed) return;
    emit({ phase: "unavailable" });
    if (!retry)
      retry = setTimeout(() => {
        retry = null;
        unsubscribe?.();
        connect();
      }, 2000);
  };
  async function refresh() {
    if (closed) return;
    if (fetching) {
      dirty = true;
      return;
    }
    fetching = true;
    try {
      const page = await agent.timeline.refetch({
        direction: "tail",
        limit: 100,
        projection: "projected",
      });
      if (!closed) emit(timelineActivity(page));
    } catch {
      unavailable();
    } finally {
      fetching = false;
      if (dirty && !closed) {
        dirty = false;
        schedule();
      }
    }
  }
  function schedule() {
    if (!closed && !timer)
      timer = setTimeout(() => {
        timer = null;
        void refresh();
      }, 100);
  }
  if (!agent.timeline) {
    emit({ phase: "unavailable" });
    return () => {
      closed = true;
    };
  }
  function connect() {
    if (closed) return;
    try {
      unsubscribe = agent.timeline.subscribe(({ event }) => {
        if (event.type === "error") unavailable();
        else schedule(); // Refetch repairs replacement epochs and reconnect gaps.
      });
      Promise.resolve(unsubscribe.ready).then(refresh, unavailable);
    } catch {
      unavailable();
    }
  }
  connect();
  return () => {
    closed = true;
    clearTimeout(timer);
    clearTimeout(retry);
    unsubscribe?.();
  };
}
