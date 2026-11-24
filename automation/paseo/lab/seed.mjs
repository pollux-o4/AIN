import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { AI_MODELS } from "../../contracts/ai-models.mjs";
import { flowIssue, STAGES } from "../../editorial/domain/index.mjs";
import { EditorialStore } from "../../editorial/index.mjs";

const FIGURE_LEFTOVERS = ["resumeStatus", "feedback", "feedbackSource", "routeReason"];
// 원본 상태를 그대로 복제한다. 전이를 재생하면 구간별 초안(구간마다 complete)을 재현할 수 없다.
// from=satisfied: 확정 초안에서 시작(위치 선정 실험) · from=choice: 위치 후보까지 같은 상태에서 시작(구성 실험, ADR-0026)
function cloneState(sourceState, articleId, from) {
  const state = structuredClone(sourceState);
  state.articleId = articleId;
  for (const key of FIGURE_LEFTOVERS) delete state[key];
  if (from === "choice") {
    const { phase, revision, candidates, coverage, note } = state.figure;
    assert.equal(phase, "choose", "Choice seed needs a source waiting for figure choice");
    state.figure = {
      phase,
      revision,
      candidates,
      ...(coverage ? { coverage } : {}),
      ...(note ? { note } : {}),
    };
    state.status = "awaiting_figure_choice";
  } else {
    delete state.figure;
    state.status = "satisfied";
  }
  assert.equal(flowIssue(state), null, "Seeded state must pass flowIssue");
  return state;
}

/** @param {{ runtimeDir: string, fromArticle: string, from?: "satisfied" | "choice" }} options */
export function seedFromArticle({ runtimeDir, fromArticle, from = "satisfied" }) {
  mkdirSync(runtimeDir, { recursive: true });
  const store = new EditorialStore(join(runtimeDir, "editorial.sqlite"));
  try {
    const matches = store.findByPrefix(fromArticle);
    if (matches.length !== 1)
      throw new Error(`원본 글을 하나로 찾지 못했습니다: ${fromArticle} (${matches.length}건)`);
    const source = matches[0].state;
    const ready =
      from === "choice"
        ? source.figure?.phase === "choose"
        : source.satisfiedRevision === source.revision &&
          STAGES.every((stage) => source.artifacts?.[stage]);
    if (!ready) throw new Error(`원본 글이 ${from} 시작 상태가 아닙니다: ${fromArticle}`);
    const articleId = randomUUID();
    const state = cloneState(source, articleId, from);
    const now = Date.now();
    const run = {
      id: articleId,
      requestId: `lab-${articleId}`,
      state,
      ai: { ...AI_MODELS.standard, enabled: true, maxDurationMs: 300_000 },
      callsUsed: 0,
      maxCalls: STAGES.length,
      startedAt: now,
      updatedAt: now,
      operations: {},
      issue: null,
      pending: null,
      queuedAt: now,
      worker: null,
      events: [
        {
          at: now,
          kind: "satisfied",
          label: from === "choice" ? "위치 후보(시드)" : "초안 확정(시드)",
          revision: state.revision,
        },
      ],
    };
    store.save(run);
    return { articleId };
  } finally {
    store.close();
  }
}
