// 시각자료 선택 단계: 초안 확정 뒤 앵커 문장 뒤에 배치만 · 본문·확정은 그대로 · FIGURE-001
// phase: propose(AI 위치 제안) → choose(사람 선택) → generate(그림 한 장씩 초안→내용→시각 층) → review(사람 확인) → confirmed
import { headingNodes } from "../../contracts/article-structure.mjs";
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
// 생성 중인 그림 한 장과 그 층 · 그림 단위 진행(current) 도입 전 상태는 첫 그림의 첫 층부터 다시 · ADR-0017
export function currentOf(figure) {
  if (figure.current) return figure.current;
  const done = new Set((figure.items ?? []).map((item) => item.id));
  return { id: figure.selected?.find((id) => !done.has(id)), pass: FIGURE_PASSES[0] };
}
export const passOf = (figure) => currentOf(figure).pass;
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
    const { id, pass } = currentOf(figure);
    const at = FIGURE_PASSES.indexOf(pass);
    if (at < 0 || !figure.selected.includes(id)) return "Figure generation step is invalid";
    const done = (figure.items ?? []).map((item) => item.id);
    if (!done.every((made) => figure.selected.includes(made) && made !== id))
      return "Finished figures must precede the current one";
    if (at === 0) return figure.draft === undefined ? null : "First pass has no draft";
    return figure.draft?.id === id ? null : "Figure draft must match the current figure";
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
  const figure = state.figure;
  if (figure.phase !== "generate")
    return {
      type: "request_figure",
      stage: "figure_plan",
      revision: state.revision,
      units: figureUnits(draftText(state)),
      ...(figure.note ? { note: figure.note } : {}),
    };
  const { id, pass } = currentOf(figure);
  return {
    type: "request_figure",
    stage: "figure",
    revision: state.revision,
    pass,
    // 그림 한 장 단위 작업: 세션·제한 시간·실패가 그 그림에만 걸린다
    figureId: id,
    progress: { index: figure.selected.indexOf(id) + 1, total: figure.selected.length },
    candidates: figure.candidates.filter((c) => c.id === id),
    // 앞 층 결과(svg·메모)를 다음 층이 이어받아 다듬는다
    ...(figure.draft ? { previous: [figure.draft] } : {}),
    ...(figure.note ? { note: figure.note } : {}),
  };
}
// 시각화를 검토할 단위: 글머리와 모든 소제목 마디 · 위치 제안이 빠짐없이 훑었는지 세는 기준
const LEAD_UNIT = "글머리";
function figureUnits(text) {
  return [LEAD_UNIT, ...headingNodes(text).map((node) => node.title)];
}
// 단위별 제안 집계(세기만 · JUDGE-001): 후보가 놓인 단위·건너뛴 단위·설명 없이 빠진 단위
function coverageOf(text, candidates, skipped) {
  const units = figureUnits(text);
  const withFigure = new Set(candidates.map((c) => anchorSection(text, c.anchor) ?? LEAD_UNIT));
  const skippedUnits = new Set(skipped.map((item) => item.unit.trim()));
  const missing = units.filter((unit) => !withFigure.has(unit) && !skippedUnits.has(unit));
  return {
    units: units.length,
    withFigure: units.filter((unit) => withFigure.has(unit)).length,
    skipped: units.filter((unit) => !withFigure.has(unit) && skippedUnits.has(unit)).length,
    missing,
    candidates: candidates.length,
  };
}
// 후보가 한두 개뿐이거나 훑지 않은 단위가 있으면 위치 제안을 고칠 신호 · 사람·운영자에게 표시
export function coverageGap(coverage) {
  if (!coverage) return null;
  if (coverage.missing.length) return `검토하지 않은 단위 ${coverage.missing.length}곳`;
  if (coverage.units >= 3 && coverage.candidates <= 1)
    return `단위 ${coverage.units}곳 중 후보 ${coverage.candidates}개`;
  return null;
}
// AI 후보 중 초안에 그대로 있는 문장만 인정 · 중복 앵커 제거 · 안전 상한까지 · id는 코드가 부여
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
function acceptFigure(figure, id, output, { keepNotes }) {
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
}
// 한 층을 마친 뒤: 같은 그림의 다음 층 → 다음 그림의 첫 층 → 사람 확인
function advanceFigure(state, output) {
  const figure = state.figure;
  const { id, pass } = currentOf(figure);
  const nextPass = FIGURE_PASSES[FIGURE_PASSES.indexOf(pass) + 1];
  const { draft: _draft, current: _current, pass: _pass, drafts: _drafts, ...rest } = figure;
  if (nextPass) {
    state.figure = {
      ...rest,
      current: { id, pass: nextPass },
      draft: acceptFigure(figure, id, output, { keepNotes: true }),
    };
    return;
  }
  const items = [...(figure.items ?? []), acceptFigure(figure, id, output, { keepNotes: false })];
  const nextId = figure.selected[figure.selected.indexOf(id) + 1];
  if (nextId) {
    state.figure = { ...rest, items, current: { id: nextId, pass: FIGURE_PASSES[0] } };
    return;
  }
  state.figure = { ...rest, phase: "review", items };
  state.status = "awaiting_figure_review";
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
          (event.stage === "figure_plan" ||
            ((event.pass ?? FIGURE_PASSES[0]) === passOf(figure) &&
              (event.figureId === undefined || event.figureId === currentOf(figure).id))),
        "Unexpected or stale figure result",
      );
      const output = figureOutputSchemas[event.stage].parse(event.output);
      if (event.stage === "figure_plan") {
        const candidates = acceptCandidates(state, output);
        state.figure = {
          ...figure,
          phase: "choose",
          candidates,
          coverage: coverageOf(draftText(state), candidates, output.skipped ?? []),
        };
        state.status = "awaiting_figure_choice";
      } else advanceFigure(state, output);
      return true;
    }
    case "select_figures": {
      const ids = figure?.candidates?.map((c) => c.id) ?? [];
      requireThat(
        state.status === "awaiting_figure_choice" && reviewed && subset(event.figures, ids),
        "Figure selection requires current candidates",
      );
      const selected = ordered(event.figures, ids);
      state.figure = {
        ...figure,
        phase: "generate",
        selected,
        current: { id: selected[0], pass: FIGURE_PASSES[0] },
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
