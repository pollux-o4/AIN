import assert from "node:assert/strict";
import test from "node:test";
import { timelineActivity, watchTimeline } from "../activity.mjs";

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
  assert.deepEqual(timelineActivity(page), {
    phase: "tool",
    text: "",
    truncated: false,
    lastOutputAt: null,
  });
  page.entries.push(entry({ type: "assistant_message", text: "공개 응답" }));
  assert.equal(timelineActivity(page).text, "공개 응답");
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
