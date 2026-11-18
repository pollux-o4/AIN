import {
  ACTIVITY_NOTE_LIMIT,
  ACTIVITY_STEP_LIMIT,
  ACTIVITY_TEXT_LIMIT,
} from "../contracts/activity.mjs";

const toolNames = {
  shell: "명령 실행",
  edit: "파일 수정",
  read: "자료 읽기",
  search: "자료 찾기",
  web: "웹 확인",
};
const toolStatus = (status) => (["completed", "failed"].includes(status) ? status : "running");
// 결과 JSON(단계 산출물)은 미리보기가 따로 보여 주므로 설명 문장만 진행 기록에 남긴다
const isResult = (text) => /^\s*(```(json)?\s*)?[{[]/.test(text);
function timelineSteps(entries) {
  return entries
    .flatMap((entry) => {
      const at = Date.parse(entry.timestamp) || null;
      const { item } = entry;
      if (item.type === "assistant_message" && item.text?.trim() && !isResult(item.text))
        return [{ kind: "note", text: item.text.trim().slice(0, ACTIVITY_NOTE_LIMIT), at }];
      if (item.type === "tool_call") {
        const type = typeof item.detail === "object" ? item.detail?.type : undefined;
        return [
          {
            kind: "tool",
            text: toolNames[type] ?? "도구 실행",
            status: toolStatus(item.status),
            at,
          },
        ];
      }
      return [];
    })
    .slice(-ACTIVITY_STEP_LIMIT);
}

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
    steps: timelineSteps(entries),
  };
}

// 끝난 실행의 진행 기록을 보존용으로 한 번 읽는다 · 재사용 담당이면 이번 턴 이후 항목만
export async function finalSteps(agent, afterSeq = -1) {
  const page = await agent.timeline.refetch({
    direction: "tail",
    limit: 100,
    projection: "projected",
  });
  if (page.error) throw new Error("Timeline unavailable");
  return timelineSteps((page.entries ?? []).filter((entry) => !(entry.seqStart <= afterSeq)));
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
