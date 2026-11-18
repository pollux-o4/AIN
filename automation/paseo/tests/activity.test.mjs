import assert from "node:assert/strict";
import test from "node:test";
import { finalSteps, timelineActivity, watchTimeline } from "../activity.mjs";

const entry = (item) => ({ item, timestamp: "2026-11-10T00:00:00Z" });
test("LIVE-001: public responses only, real activity, bounded preview and source timestamp", () => {
  const page = {
    agent: { status: "running" },
    entries: [
      entry({ type: "user_message", text: "private input" }),
      entry({ type: "reasoning", text: "private reasoning" }),
      entry({ type: "tool_call", status: "running", name: "shell", detail: "private command" }),
    ],
  };
  const at = Date.parse("2026-11-10T00:00:00Z");
  assert.deepEqual(timelineActivity(page), {
    phase: "tool",
    text: "",
    truncated: false,
    lastOutputAt: null,
    // 도구는 종류·상태만 · 명령 원문·추론·사용자 입력 제외
    steps: [{ kind: "tool", text: "도구 실행", status: "running", at }],
  });
  page.entries.push(entry({ type: "assistant_message", text: "공개 응답" }));
  assert.equal(timelineActivity(page).text, "공개 응답");
  assert.deepEqual(timelineActivity(page).steps.at(-1), { kind: "note", text: "공개 응답", at });
  page.entries.push(entry({ type: "assistant_message", text: '{"draft":"결과 JSON"}' }));
  assert.equal(timelineActivity(page).steps.length, 2, "결과 JSON은 진행 기록에서 제외");
  page.entries.push(
    entry({ type: "tool_call", status: "completed", detail: { type: "read", path: "secret" } }),
  );
  assert.equal(JSON.stringify(timelineActivity(page).steps).includes("secret"), false);
  assert.equal(timelineActivity(page).steps.at(-1).text, "자료 읽기");
  assert.equal(timelineActivity(page).lastOutputAt, Date.parse("2026-11-10T00:00:00Z"));
  page.agent.status = "idle";
  assert.equal(timelineActivity(page).phase, "validating");
  page.agent.pendingPermissions = [{}];
  assert.equal(timelineActivity(page).phase, "permission");
  page.entries.push(entry({ type: "assistant_message", text: "x".repeat(25000) }));
  assert.equal(timelineActivity(page).text.length, 24000);
  assert.equal(timelineActivity(page).truncated, true);
});

test("LIVE-001: snapshot recovery, updates, and disconnect release subscriptions", async () => {
  let handler,
    released = 0,
    text = "first";
  const values = [];
  const stop = watchTimeline(
    {
      timeline: {
        subscribe(fn) {
          handler = fn;
          const off = () => {
            released++;
          };
          off.ready = Promise.resolve();
          return off;
        },
        async refetch() {
          return { entries: [entry({ type: "assistant_message", text })] };
        },
      },
    },
    (value) => values.push(value),
  );
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(values.at(-1).text, "first");
  text = "restored";
  handler({ event: { type: "subscription_restored" } });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(values.at(-1).text, "restored");
  stop();
  assert.equal(released, 1);
  text = "late";
  handler({ event: { type: "timeline" } });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(values.at(-1).text, "restored");
});

test("LIVE-001: failed subscription reconnects without starting another job", async () => {
  let attempts = 0,
    released = 0;
  const values = [];
  const stop = watchTimeline(
    {
      timeline: {
        subscribe() {
          attempts++;
          const off = () => {
            released++;
          };
          off.ready = attempts === 1 ? Promise.reject(new Error("offline")) : Promise.resolve();
          return off;
        },
        async refetch() {
          return { entries: [entry({ type: "assistant_message", text: "recovered" })] };
        },
      },
    },
    (value) => values.push(value),
  );
  try {
    await new Promise((r) => setTimeout(r, 2200));
    assert.equal(values[0].phase, "unavailable");
    assert.equal(values.at(-1).text, "recovered");
    assert.equal(attempts, 2);
  } finally {
    stop();
  }
  assert.equal(released, 2);
});

test("LIVE-001: finished steps keep only this turn and hide tool details", async () => {
  const page = {
    entries: [
      { ...entry({ type: "assistant_message", text: "이전 턴" }), seqStart: 1 },
      { ...entry({ type: "assistant_message", text: "이번 턴" }), seqStart: 5 },
      {
        ...entry({
          type: "tool_call",
          status: "completed",
          detail: { type: "read", filePath: "secret" },
        }),
        seqStart: 6,
      },
    ],
  };
  const agent = { timeline: { refetch: async () => page } };
  const steps = await finalSteps(agent, 4);
  assert.deepEqual(
    steps.map((step) => step.text),
    ["이번 턴", "자료 읽기"],
  );
  assert.doesNotMatch(JSON.stringify(steps), /secret/);
  assert.equal((await finalSteps(agent)).length, 3);
});
