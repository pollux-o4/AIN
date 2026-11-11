import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { streamActivity } from "../http-stream.mjs";

test("LIVE-001: slow consumers receive the newest snapshot after drain with bounded buffering", () => {
  const res = new EventEmitter();
  const frames = [];
  let emit,
    stopped = 0;
  res.setHeader = () => {};
  res.flushHeaders = () => {};
  res.write = (frame) => {
    frames.push(frame);
    return false;
  };
  streamActivity(
    res,
    {
      observeActivity(_id, send) {
        emit = send;
        send({ text: "가".repeat(24000) });
        return () => {
          stopped++;
        };
      },
    },
    "run",
  );
  emit({ text: "old" });
  emit({ text: "new" });
  assert.equal(frames.length, 1);
  res.emit("drain");
  assert.equal(frames.length, 2);
  assert.match(frames[1], /new/);
  assert.doesNotMatch(frames[1], /old/);
  res.emit("close");
  emit({ text: "after close" });
  assert.equal(frames.length, 2);
  assert.equal(stopped, 1);
});
