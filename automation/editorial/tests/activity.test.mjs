import assert from "node:assert/strict";
import test from "node:test";
import { transition } from "../domain/index.mjs";
import { observeActivity } from "../service/activity.mjs";

const flush = () => new Promise((r) => setImmediate(r));
test("LIVE-001: stage identity, late events, failure retention and no execution side effects", async () => {
  const run = {
    state: transition(null, {
      id: "start",
      actor: "user",
      type: "start",
      articleId: "run",
      idea: "fixture",
    }).state,
    pending: { jobId: "one" },
  };
  const handlers = [],
    snapshots = [],
    released = [];
  const service = {
    store: { get: () => run },
    jobs: {
      async watchActivity(id, emit) {
        handlers.push(emit);
        emit({ phase: "generating", text: "partial", lastOutputAt: 42 });
        return () => released.push(id);
      },
    },
  };
  const stop = observeActivity(service, "run", (s) => snapshots.push(s));
  await flush();
  assert.equal(snapshots.at(-1).name, "진단");
  handlers[0]({ phase: "unavailable" });
  assert.equal(snapshots.at(-1).text, "partial");
  assert.equal(snapshots.at(-1).lastOutputAt, 42);
  run.state.revision = 2;
  run.pending.jobId = "two";
  handlers[0]({ phase: "generating", text: "wrong before identity sync" });
  assert.equal(snapshots.at(-1).revision, 1);
  await new Promise((r) => setTimeout(r, 1100));
  handlers[0]({ phase: "generating", text: "wrong revision" });
  assert.equal(snapshots.at(-1).revision, 2);
  assert.equal(snapshots.at(-1).text, "partial");
  stop();
  assert.deepEqual(released, ["one", "two"]);
  handlers[1]({ phase: "generating", text: "after close" });
  assert.equal(snapshots.at(-1).text, "partial");
});

test("LIVE-001: disconnect while acquiring observation releases the eventual subscription", async () => {
  let resolve,
    released = 0;
  const run = {
    state: { revision: 1, stage: "draft", status: "waiting_ai" },
    pending: { jobId: "one" },
  };
  const service = {
    store: { get: () => run },
    jobs: {
      watchActivity: () =>
        new Promise((r) => {
          resolve = r;
        }),
    },
  };
  const stop = observeActivity(service, "run", () => assert.fail("late event"));
  stop();
  resolve(() => {
    released++;
  });
  await flush();
  assert.equal(released, 1);
});

test("LIVE-001: incomplete legacy state never claims completed observation", () => {
  const snapshots = [];
  const service = {
    store: { get: () => ({ state: { revision: 1, status: "waiting_ai", stage: "draft" } }) },
    jobs: { watchActivity: () => assert.fail("No AI observation needed") },
  };
  const stop = observeActivity(service, "legacy", (snapshot) => snapshots.push(snapshot));
  stop();
  assert.equal(snapshots[0].active, false);
  assert.equal(snapshots[0].phase, "failed");
});
