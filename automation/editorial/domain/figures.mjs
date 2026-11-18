// 시각자료 선택 단계: 초안 확정 뒤 앵커 문장 뒤에 배치만 · 본문·확정은 그대로 · FIGURE-001
// phase: propose(AI 위치 제안) → choose(사람 선택) → generate(AI 생성: 초안→내용→시각 층) → review(사람 확인) → confirmed
import { FIGURE_LIMITS, FIGURE_PASSES, figureOutputSchemas } from "../../contracts/figure.mjs";

const PHASE_STATUS = {
  propose: ["waiting_figure"],
  generate: ["waiting_figure"],
  choose: ["awaiting_figure_choice"],
  review: ["awaiting_figure_review"],
  confirmed: ["satisfied", "publication_ready"],
};
export const FIGURE_WAITING = "waiting_figure";
export const FIGURE_AWAITING = Object.freeze(["awaiting_figure_choice", "awaiting_figure_review"]);
export const FIGURE_USER_EVENTS = Object.freeze([
  "request_figures",
  "select_figures",
  "confirm_figures",
  "discard_figures",
]);
function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}
// 층 도입 전 생성 대기 상태는 첫 층으로 본다
export const passOf = (figure) => figure.pass ?? FIGURE_PASSES[0];
const draftText = (state) => state.artifacts?.draft?.output?.text ?? "";
const effectiveStatus = (state) =>
  ["paused", "failed"].includes(state.status) ? state.resumeStatus : state.status;
// 진행 중인 AI 작업의 단계 이름 키 · 시각자료 작업이 아니면 null
export function figureStage(state) {
  if (effectiveStatus(state) !== FIGURE_WAITING) return null;
  return state.figure?.phase === "generate" ? "figure" : "figure_plan";
}
const subset = (ids, pool) =>
  Array.isArray(ids) &&
  ids.length > 0 &&
  new Set(ids).size === ids.length &&
  ids.every((id) => pool.includes(id));

// 상태 계약: 단계와 상태가 맞고, 모든 앵커가 현재 초안에 글자 그대로 있어야 함
export function figureIssue(state, status) {
  const figure = state.figure;
  const figureStatus = status === FIGURE_WAITING || FIGURE_AWAITING.includes(status);
  if (figure === undefined) return figureStatus ? "Figure status requires figure work" : null;
  if (figure === null || typeof figure !== "object") return "Invalid figure work";
  if (!PHASE_STATUS[figure.phase]?.includes(status)) return "Figure phase does not match status";
  if (figure.revision !== state.revision) return "Figure work must reference current revision";
  if (figure.phase === "propose") return null;
  const text = draftText(state);
  const candidates = figure.candidates;
  if (
    !Array.isArray(candidates) ||
    candidates.length < 1 ||
    candidates.length > FIGURE_LIMITS.candidates ||
    !candidates.every((c) => typeof c?.id === "string" && text.includes(c.anchor))
  )
    return "Figure candidates must anchor to the current draft";
  const ids = candidates.map((c) => c.id);
  if (figure.phase === "choose") return null;
  if (!subset(figure.selected, ids)) return "Figure selection must reference candidates";
  if (figure.phase === "generate") {
    const at = FIGURE_PASSES.indexOf(passOf(figure));
    if (at < 0) return "Figure generation pass is invalid";
    if (at === 0) return figure.drafts === undefined ? null : "First pass has no drafts";
    return subset(
      figure.drafts?.map((item) => item.id),
      figure.selected,
    ) && figure.drafts.length === figure.selected.length
      ? null
      : "Figure drafts must match the selection";
  }
  if (
    !subset(
      figure.items?.map((item) => item.id),
      figure.selected,
    )
  )
    return "Figures must match the selection";
  return null;
}
export function figureAction(state) {
  const generate = state.figure.phase === "generate";
  return {
    type: "request_figure",
    stage: generate ? "figure" : "figure_plan",
    revision: state.revision,
    ...(generate ? { pass: passOf(state.figure) } : {}),
    // 앞 층 결과(svg·메모)를 다음 층이 이어받아 다듬는다
    ...(generate && state.figure.drafts ? { previous: state.figure.drafts } : {}),
    ...(state.figure.note ? { note: state.figure.note } : {}),
    ...(generate
      ? {
          candidates: state.figure.candidates.filter((c) => state.figure.selected.includes(c.id)),
        }
      : {}),
  };
}
// AI 후보 중 초안에 그대로 있는 문장만 인정 · 중복 앵커 제거 · 최대 3개 · id는 코드가 부여
function acceptCandidates(state, output) {
  const text = draftText(state);
  const seen = new Set();
  const candidates = [];
  for (const { anchor, claim, reason, analogy, scene, kind } of output.candidates) {
    const sentence = anchor.trim();
    if (!text.includes(sentence) || seen.has(sentence)) continue;
    seen.add(sentence);
    candidates.push({
      id: `f${candidates.length + 1}`,
      anchor: sentence,
      claim: claim.trim(),
      reason: reason.trim(),
      ...(analogy?.trim() ? { analogy: analogy.trim() } : {}),
      scene: scene.trim(),
      ...(kind ? { kind } : {}),
    });
    if (candidates.length === FIGURE_LIMITS.candidates) break;
  }
  requireThat(candidates.length > 0, "No figure anchor matches the confirmed draft");
  return candidates;
}
function acceptFigures(figure, output, { keepNotes }) {
  return figure.selected.map((id) => {
    const made = output.figures.find((item) => item.id === id);
    requireThat(made, `Missing figure for selected candidate: ${id}`);
    const { anchor, claim } = figure.candidates.find((c) => c.id === id);
    return {
      id,
      anchor,
      claim,
      svg: made.svg,
      alt: made.alt.trim(),
      ...(made.caption ? { caption: made.caption.trim() } : {}),
      ...(keepNotes && made.notes?.trim() ? { notes: made.notes.trim() } : {}),
    };
  });
}
const ordered = (ids, pool) => pool.filter((id) => ids.includes(id));

// 시각자료 이벤트 처리 · 다루지 않는 이벤트면 false
export function figureTransition(state, event) {
  const figure = state.figure;
  const reviewed = event.reviewedRevision === state.revision;
  switch (event.type) {
    case "request_figures":
      requireThat(
        state.status === "satisfied" && !figure && reviewed,
        "Figures require the current confirmed draft without figure work",
      );
      state.figure = {
        phase: "propose",
        revision: state.revision,
        ...(typeof event.note === "string" && event.note ? { note: event.note } : {}),
      };
      state.status = FIGURE_WAITING;
      return true;
    case "figure_result": {
      requireThat(
        state.status === FIGURE_WAITING &&
          event.revision === state.revision &&
          event.stage === figureStage(state) &&
          (event.stage === "figure_plan" || (event.pass ?? FIGURE_PASSES[0]) === passOf(figure)),
        "Unexpected or stale figure result",
      );
      const output = figureOutputSchemas[event.stage].parse(event.output);
      if (event.stage === "figure_plan") {
        state.figure = { ...figure, phase: "choose", candidates: acceptCandidates(state, output) };
        state.status = "awaiting_figure_choice";
      } else {
        const next = FIGURE_PASSES[FIGURE_PASSES.indexOf(passOf(figure)) + 1];
        const { pass: _pass, drafts: _drafts, ...rest } = figure;
        if (next) {
          // 같은 대기 상태에서 다음 층 AI 작업으로 이어짐 · 사람 확인은 마지막 층 뒤 한 번
          state.figure = {
            ...figure,
            pass: next,
            drafts: acceptFigures(figure, output, { keepNotes: true }),
          };
        } else {
          state.figure = {
            ...rest,
            phase: "review",
            items: acceptFigures(figure, output, { keepNotes: false }),
          };
          state.status = "awaiting_figure_review";
        }
      }
      return true;
    }
    case "select_figures": {
      const ids = figure?.candidates?.map((c) => c.id) ?? [];
      requireThat(
        state.status === "awaiting_figure_choice" && reviewed && subset(event.figures, ids),
        "Figure selection requires current candidates",
      );
      state.figure = {
        ...figure,
        phase: "generate",
        pass: FIGURE_PASSES[0],
        selected: ordered(event.figures, ids),
      };
      state.status = FIGURE_WAITING;
      return true;
    }
    case "confirm_figures": {
      const ids = figure?.items?.map((item) => item.id) ?? [];
      const keep = event.figures ?? ids;
      requireThat(
        state.status === "awaiting_figure_review" && reviewed && subset(keep, ids),
        "Figure confirmation requires current prepared figures",
      );
      state.figure = {
        ...figure,
        phase: "confirmed",
        items: figure.items.filter((item) => keep.includes(item.id)),
        confirmedEventId: event.id,
      };
      state.status = "satisfied";
      return true;
    }
    case "discard_figures":
      requireThat(
        figure && reviewed && [...FIGURE_AWAITING, "satisfied"].includes(state.status),
        "No figure work to discard",
      );
      delete state.figure;
      state.status = "satisfied";
      return true;
    default:
      return false;
  }
}

// 확인 대상(review)·확인된(confirmed) 시각자료 · 그 밖에는 배치할 것이 없음
export function placedFigures(state) {
  return ["review", "confirmed"].includes(state.figure?.phase) ? state.figure.items : [];
}
// 본문을 바꾸지 않고 앵커 문장이 든 문단 뒤에 끼울 자리를 계산 → [{text} | {figure}] 순서열
// 문단 경계는 빈 줄 · 코드 블록(```) 안에서는 끊지 않음
export function placeFigures(text, items) {
  const cuts = items
    .map((figure) => {
      const at = text.indexOf(figure.anchor);
      if (at < 0) return null;
      let end = at + figure.anchor.length;
      for (;;) {
        const next = text.indexOf("\n\n", end);
        if (next < 0) return { end: text.length, figure };
        end = next;
        if ((text.slice(0, end).match(/^```/gm)?.length ?? 0) % 2 === 0) return { end, figure };
        end += 2;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.end - b.end);
  const segments = [];
  let from = 0;
  for (const { end, figure } of cuts) {
    if (end > from) segments.push({ text: text.slice(from, end) });
    segments.push({ figure });
    from = end;
  }
  if (from < text.length) segments.push({ text: text.slice(from) });
  return segments;
}
// 후보가 놓일 구간 제목(가장 가까운 앞 소제목) · 사람이 위치를 가늠하는 용도
export function anchorSection(text, anchor) {
  const at = text.indexOf(anchor);
  if (at < 0) return null;
  return (
    text
      .slice(0, at)
      .match(/^#{2,}\s+(.+)$/gm)
      ?.at(-1)
      ?.replace(/^#+\s+/, "") ?? null
  );
}
