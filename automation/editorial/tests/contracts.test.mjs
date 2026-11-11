import assert from "node:assert/strict";
import test from "node:test";
import {
  actionRequestSchema,
  advanceRequestSchema,
  createRequestSchema,
} from "../../contracts/requests.mjs";
import { DEFAULT_DIRECTION } from "../../contracts/writing-modes.mjs";
import { STAGES } from "../domain/index.mjs";
import { EditorialService } from "../service.mjs";

function fixture() {
  const records = new Map();
  const store = {
    save(run) {
      records.set(run.id, structuredClone(run));
    },
    get(id) {
      return structuredClone(records.get(id));
    },
    find(requestId) {
      return [...records.values()].find((run) => run.requestId === requestId);
    },
  };
  const service = new EditorialService({
    store,
    jobs: {},
    dispatch: async () => {},
    now: () => 1000,
  });
  return { service, records };
}

test("request schemas accept existing inputs and deliberately retain extensions", () => {
  const input = { requestId: "id", idea: " idea ", source: "", extension: { x: 1 } };
  assert.deepEqual(createRequestSchema.parse(input), input);
  assert.equal(
    actionRequestSchema.safeParse({ operationId: "op", type: "pause", expectedVersion: 1 }).success,
    true,
  );
  assert.deepEqual(advanceRequestSchema.parse({ executionId: "n8n_1-2", extra: true }), {
    executionId: "n8n_1-2",
    extra: true,
  });
});

test("full action schema requires text only for feedback operations", () => {
  const base = { operationId: "op", expectedVersion: 1 };
  for (const feedback of [undefined, null, {}, " ", "x".repeat(12001)])
    assert.equal(
      actionRequestSchema.safeParse({ ...base, type: "feedback", feedback }).success,
      false,
    );
  assert.equal(
    actionRequestSchema.safeParse({ ...base, type: "feedback", feedback: "수정" }).success,
    true,
  );
  assert.equal(
    actionRequestSchema.safeParse({ ...base, type: "pause", feedback: {} }).success,
    true,
  );
});

test("malformed create requests retain API messages and never save a run", async () => {
  const { service, records } = fixture();
  for (const input of [null, [], "idea"])
    await assert.rejects(() => service.create(input), {
      status: 400,
      message: "글감을 입력해 주세요.",
    });
  for (const input of [
    {},
    { requestId: "id", idea: " " },
    { requestId: [], idea: "idea" },
    { requestId: "id", idea: "a".repeat(12001) },
    { requestId: "id", idea: "idea", source: null },
    { requestId: "id", idea: "idea", source: "a".repeat(200001) },
  ])
    await assert.rejects(() => service.create(input), {
      status: 400,
      message: "글감과 참고 자료의 길이를 확인해 주세요.",
    });
  assert.equal(records.size, 0);
});

test("malformed action and advance requests reject without mutating stored work", async () => {
  const { service, records } = fixture();
  const run = await service.create({ requestId: "id", idea: " idea " });
  const before = structuredClone(records.get(run.id));
  const action = { operationId: "op", type: "pause", expectedVersion: run.version };
  for (const [input, message, status] of [
    [null, "요청 내용을 확인해 주세요.", 400],
    [[], "요청 내용을 확인해 주세요.", 400],
    [{ ...action, operationId: " " }, "지원하지 않는 요청입니다.", 400],
    [{ ...action, type: "publish" }, "지원하지 않는 요청입니다.", 400],
    [
      { ...action, expectedVersion: "1" },
      "다른 화면에서 작업이 변경됐습니다. 최신 내용을 확인해 주세요.",
      409,
    ],
    [{ ...action, type: "feedback", feedback: {} }, "수정할 내용을 입력해 주세요.", 400],
  ]) {
    await assert.rejects(() => service.action(run.id, input), { message, status });
    assert.deepEqual(records.get(run.id), before);
  }
  for (const input of [
    null,
    [],
    { executionId: "../bad" },
    { executionId: 1 },
    { executionId: "x".repeat(81) },
  ]) {
    await assert.rejects(() => service.advance(run.id, input), {
      status: 400,
      message:
        input === null || Array.isArray(input)
          ? "실행 정보를 확인해 주세요."
          : "실행 식별자를 확인해 주세요.",
    });
    assert.deepEqual(records.get(run.id), before);
  }
  assert.deepEqual(before.state.plan, STAGES);
  assert.equal(before.state.idea, "idea");
});

test("request parsing preserves duplicate identities and version/error precedence", async () => {
  const { service, records } = fixture();
  const input = { requestId: "id", idea: " idea ", source: "" };
  const run = await service.create(input);
  assert.equal((await service.create({ ...input, ignored: true })).id, run.id);
  await assert.rejects(() => service.create({ ...input, source: "changed" }), {
    status: 409,
    message: "같은 제출 번호의 입력이 달라졌습니다.",
  });
  const action = {
    operationId: "op",
    type: "pause",
    expectedVersion: run.version,
    feedback: { ignored: true },
  };
  await service.action(run.id, action);
  const paused = structuredClone(records.get(run.id));
  await service.action(run.id, { ...action, ignored: true });
  assert.deepEqual(records.get(run.id), paused);
  await assert.rejects(() => service.action(run.id, { ...action, feedback: "different" }), {
    status: 409,
    message: "같은 요청 번호의 내용이 달라졌습니다.",
  });
  await assert.rejects(
    () =>
      service.action(run.id, { ...action, operationId: "new", type: "feedback", feedback: null }),
    { status: 409, message: "다른 화면에서 작업이 변경됐습니다. 최신 내용을 확인해 주세요." },
  );
  assert.deepEqual(records.get(run.id), paused);
});

test("direction is parsed before saving and normalized for duplicate requests", async () => {
  const { service, records } = fixture();
  const input = { requestId: "direction", idea: "글 방향 선택" };
  const direction = { mode: "narrate", readerLevel: "auto" };
  const view = await service.create({ ...input, direction: { mode: "narrate" } });
  const before = structuredClone(records.get(view.id));
  assert.deepEqual(before.state.direction, direction);
  assert.equal((await service.create({ ...input, direction })).id, view.id);
  assert.equal(
    (
      await service.create({
        ...input,
        direction: { readerLevel: "auto", mode: "narrate", ignored: true },
      })
    ).id,
    view.id,
  );
  for (const changed of [undefined, { mode: "explain" }, { ...direction, readerLevel: "expert" }]) {
    await assert.rejects(() => service.create({ ...input, direction: changed }), {
      status: 409,
      message: "같은 제출 번호의 입력이 달라졌습니다.",
    });
    assert.deepEqual(records.get(view.id), before);
  }

  const automatic = await service.create({ ...input, requestId: "automatic" });
  assert.deepEqual(records.get(automatic.id).state.direction, DEFAULT_DIRECTION);
  const stored = records.get(automatic.id);
  delete stored.state.direction;
  const legacy = structuredClone(stored);
  for (const direction of [undefined, {}, DEFAULT_DIRECTION])
    assert.equal(
      (await service.create({ ...input, requestId: "automatic", direction })).id,
      automatic.id,
    );
  await assert.rejects(
    () => service.create({ ...input, requestId: "automatic", direction: { mode: "argue" } }),
    { status: 409 },
  );
  assert.deepEqual(records.get(automatic.id), legacy);
});

test("invalid directions never save or dispatch work", async () => {
  const { service, records } = fixture();
  let dispatches = 0;
  service.dispatch = async () => dispatches++;
  for (const direction of [
    null,
    [],
    "explain",
    { mode: "explanation" },
    { mode: null },
    { readerLevel: "advanced" },
    { readerLevel: 1 },
  ])
    await assert.rejects(
      () => service.create({ requestId: "invalid-direction", idea: "글감", direction }),
      { status: 400 },
    );
  assert.equal(records.size, 0);
  assert.equal(dispatches, 0);
});

test("all user commands have explicit request contracts", () => {
  for (const type of [
    "feedback",
    "pause",
    "resume",
    "complete_requirements",
    "satisfy",
    "authorize_publication",
  ])
    assert.equal(
      actionRequestSchema.safeParse({
        operationId: type,
        expectedVersion: 1,
        type,
        feedback: "수정",
      }).success,
      true,
    );
});

test("new requests reject compact, reordered and invalid plans without dispatch or storage", async () => {
  const { service, records } = fixture();
  let dispatches = 0;
  service.dispatch = async () => {
    dispatches++;
  };
  for (const plan of [["diagnose", "draft", "review"], [...STAGES].reverse(), [], null, "all"])
    await assert.rejects(() => service.create({ requestId: "bad", idea: "전체 과정", plan }), {
      status: 400,
    });
  assert.equal(records.size, 0);
  assert.equal(dispatches, 0);
  const view = await service.create({ requestId: "full", idea: "전체 과정", plan: [...STAGES] });
  assert.deepEqual(records.get(view.id).state.plan, STAGES);
  assert.equal(view.needsCompletion, false);
  assert.equal(view.canCompleteRequirements, false);
});
