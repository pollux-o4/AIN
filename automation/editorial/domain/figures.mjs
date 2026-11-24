// 시각자료 선택 단계: 초안 확정 뒤 앵커 문장 뒤에 배치만 · 본문·확정은 그대로 · FIGURE-001
// phase: propose(AI 위치 선정) → choose(사람 선택) → compose(AI 구성, 고른 자리 전부) → design(사람 승인)
//   → generate(그림 한 장씩 초안→내용→시각 층) → review(사람 확인) → confirmed · 확인에서 compose·generate로 되돌림 · ADR-0026
import { headingNodes } from "../../contracts/article-structure.mjs";
import {
  FIGURE_FIX_PASS,
  FIGURE_LIMITS,
  FIGURE_PASSES,
  FIGURE_REVISE_TARGETS,
  figureOutputSchemas,
} from "../../contracts/figure.mjs";
import { bindConsistency, consistencyFor } from "./figure-consistency.mjs";

const PHASE_STATUS = {
  propose: ["waiting_figure"],
  compose: ["waiting_figure"],
  generate: ["waiting_figure"],
  choose: ["awaiting_figure_choice"],
  design: ["awaiting_figure_design"],
  review: ["awaiting_figure_review"],
  confirmed: ["satisfied", "publication_ready"],
};
export const FIGURE_WAITING = "waiting_figure";
export const FIGURE_AWAITING = Object.freeze([
  "awaiting_figure_choice",
  "awaiting_figure_design",
  "awaiting_figure_review",
]);
export const FIGURE_USER_EVENTS = Object.freeze([
  "request_figures",
  "select_figures",
  "approve_design",
  "revise_design",
  "revise_figures",
  "confirm_figures",
  "discard_figures",
]);
function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}
// 아직 그림이 없는 고른 자리 · 되돌린 그림은 items에서 빠져 다시 만든다
const pendingIds = (figure, items = figure.items ?? []) => {
  const done = new Set(items.map((item) => item.id));
  return (figure.selected ?? []).filter((id) => !done.has(id));
};
// 지금 생성 중인 묶음: 같은 층을 밟는 그림들 · 그림마다 따로 그리되 동시에 돌린다 · ADR-0026
// 묶음 도입 전 상태(current.id·draft 한 장)도 같은 모양으로 읽는다
export function currentOf(figure) {
  const current = figure.current;
  if (current) return { ids: current.ids ?? [current.id], pass: current.pass };
  return { ids: pendingIds(figure), pass: FIGURE_PASSES[0] };
}
// 결과가 가리키는 묶음이 지금 묶음과 같은가 · 묶음 표시가 없는 결과는 내용(그림 id) 검사에 맡긴다
const sameBatch = (event, ids) => {
  const got = event.figureIds ?? (event.figureId ? [event.figureId] : null);
  return !got || (got.length === ids.length && got.every((id) => ids.includes(id)));
};
const draftsOf = (figure) =>
  figure.passDrafts ?? (figure.draft ? { [figure.draft.id]: figure.draft } : {});
export const passOf = (figure) => currentOf(figure).pass;
const draftText = (state) => state.artifacts?.draft?.output?.text ?? "";
const effectiveStatus = (state) =>
  ["paused", "failed"].includes(state.status) ? state.resumeStatus : state.status;
// 진행 중인 AI 작업의 단계 이름 키 · 시각자료 작업이 아니면 null
export function figureStage(state) {
  if (effectiveStatus(state) !== FIGURE_WAITING) return null;
  const phase = state.figure?.phase;
  return phase === "generate" ? "figure" : phase === "compose" ? "figure_compose" : "figure_plan";
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
  if (figure.phase === "compose")
    return figure.recompose === undefined || subset(figure.recompose, figure.selected)
      ? null
      : "Recompose must reference the selection";
  if (figure.phase === "design") {
    const designed = figure.candidates.filter((c) => figure.selected.includes(c.id));
    return designed.every((c) => typeof c.scene === "string")
      ? null
      : "Every selected figure needs a design";
  }
  if (figure.phase === "generate") {
    const { ids, pass } = currentOf(figure);
    const at = pass === FIGURE_FIX_PASS ? FIGURE_PASSES.length : FIGURE_PASSES.indexOf(pass);
    if (at < 0 || !ids.length || !subset(ids, figure.selected))
      return "Figure generation step is invalid";
    const done = (figure.items ?? []).map((item) => item.id);
    if (!done.every((made) => figure.selected.includes(made) && !ids.includes(made)))
      return "Finished figures must not be in the current batch";
    const drafts = draftsOf(figure);
    if (at === 0) return Object.keys(drafts).length === 0 ? null : "First pass has no draft";
    return ids.every((id) => drafts[id]?.id === id)
      ? null
      : "Figure draft must match the current figures";
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
const DESIGN_FIELDS = ["analogy", "scene", "mapping", "motifs"];
const withoutDesign = (candidate) =>
  Object.fromEntries(Object.entries(candidate).filter(([key]) => !DESIGN_FIELDS.includes(key)));
// 구성 작업 입력: 고른 자리 전부 · 다시 구성이면 유지할 자리의 구성과 세계·계약도 함께 · ADR-0026
function composeAction(state) {
  const figure = state.figure;
  const targets = figure.recompose ?? figure.selected;
  return {
    type: "request_figure",
    stage: "figure_compose",
    revision: state.revision,
    candidates: figure.candidates
      .filter((c) => figure.selected.includes(c.id))
      .map((c) => (targets.includes(c.id) ? withoutDesign(c) : c)),
    ...(figure.recompose
      ? {
          recompose: figure.recompose,
          ...(figure.world ? { world: figure.world } : {}),
          ...(figure.style ? { style: figure.style } : {}),
          ...(figure.motifs?.length ? { motifs: figure.motifs } : {}),
        }
      : {}),
    ...(figure.feedback ? { feedback: figure.feedback } : {}),
    ...(figure.note ? { note: figure.note } : {}),
    // 사람이 고른 스타일 · 구성은 이 스타일의 색·선 안에서 계약을 정한다 · ADR-0027
    ...(figure.look ? { look: figure.look } : {}),
  };
}
export function figureAction(state) {
  const figure = state.figure;
  if (figure.phase === "compose") return composeAction(state);
  if (figure.phase !== "generate")
    return {
      type: "request_figure",
      stage: "figure_plan",
      revision: state.revision,
      units: figureUnits(draftText(state)),
      ...(figure.note ? { note: figure.note } : {}),
    };
  const { ids, pass } = currentOf(figure);
  const drafts = draftsOf(figure);
  return {
    type: "request_figure",
    stage: "figure",
    revision: state.revision,
    pass,
    figureIds: ids,
    // 그림 한 장 단위 작업: 실행기가 그림마다 따로, 동시에 돌린다 · 세션·제한 시간이 그 그림에만 걸린다 · ADR-0017·ADR-0026
    parts: ids.map((id) => ({
      figureId: id,
      progress: { index: figure.selected.indexOf(id) + 1, total: figure.selected.length },
      candidates: figure.candidates.filter((c) => c.id === id),
      // 그림 사이 일관성 계약 · ADR-0022
      ...consistencyFor(figure, id),
      // 앞 층 결과(svg·원본·메모)를 다음 층이 이어받아 다듬는다
      ...(drafts[id] ? { previous: [drafts[id]] } : {}),
    })),
    ...(figure.world ? { world: figure.world } : {}),
    ...(figure.note ? { note: figure.note } : {}),
  };
}
// 묶음 작업을 그림 한 장 작업들로 나눈다 · 실행기·시험이 같은 규칙을 쓴다 · ADR-0026
export function partActions(action) {
  const { parts, figureIds: _ids, ...shared } = action;
  return parts ? parts.map((part) => ({ ...shared, ...part })) : [action];
}
// 시각화를 검토할 단위: 도입부와 모든 소제목 하위 항목 · 위치 제안이 빠짐없이 훑었는지 세는 기준
const LEAD_UNIT = "도입부";
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
  for (const { anchor, claim, reason, kind, without } of output.candidates) {
    const sentence = anchor.trim();
    if (!text.includes(sentence) || seen.has(sentence)) continue;
    seen.add(sentence);
    candidates.push({
      id: `f${candidates.length + 1}`,
      anchor: sentence,
      claim: claim.trim(),
      reason: reason.trim(),
      ...(kind ? { kind } : {}),
      ...(without?.trim() ? { without: without.trim() } : {}),
    });
    if (candidates.length === FIGURE_LIMITS.candidates) break;
  }
  requireThat(candidates.length > 0, "No figure anchor matches the confirmed draft");
  return candidates;
}
const acceptMapping = (mapping) =>
  mapping?.length
    ? {
        mapping: mapping.map(({ element, concept }) => ({
          element: element.trim(),
          concept: concept.trim(),
        })),
      }
    : {};
// 구성 결과: 대상 자리마다 구성 하나가 있어야 함 · 전체 구성이면 세계·계약을 새로 묶고,
// 일부 다시 구성이면 기존 세계·계약을 유지하고 계약에 있는 반복 대상 이름만 잇는다 · ADR-0022·0026
function acceptDesigns(figure, output) {
  const targets = figure.recompose ?? figure.selected;
  const byId = new Map(output.designs.map((design) => [design.id, design]));
  for (const id of targets) requireThat(byId.has(id), `Missing design for selected figure: ${id}`);
  const designed = figure.candidates.map((candidate) => {
    if (!targets.includes(candidate.id)) return candidate;
    const { analogy, scene, mapping, motifs } = byId.get(candidate.id);
    return {
      ...withoutDesign(candidate),
      ...(analogy?.trim() ? { analogy: analogy.trim() } : {}),
      scene: scene.trim(),
      ...acceptMapping(mapping),
      ...(motifs ? { motifs } : {}),
    };
  });
  const { recompose: _recompose, feedback: _feedback, ...rest } = figure;
  if (figure.recompose) {
    const names = new Set((figure.motifs ?? []).map((motif) => motif.name));
    return {
      ...rest,
      candidates: designed.map((c) =>
        targets.includes(c.id) && c.motifs
          ? { ...c, motifs: c.motifs.map((n) => n.trim()).filter((n) => names.has(n)) }
          : c,
      ),
    };
  }
  const selected = designed.filter((c) => figure.selected.includes(c.id));
  const { candidates: bound, ...consistency } = bindConsistency(output, selected);
  // 사람이 고른 스타일은 구성 결과보다 우선한다
  if (figure.look) consistency.style = { ...consistency.style, look: figure.look };
  const boundById = new Map(bound.map((c) => [c.id, c]));
  const { style: _style, motifs: _motifs, world: _world, ...base } = rest;
  return {
    ...base,
    candidates: designed.map((c) => boundById.get(c.id) ?? c),
    ...consistency,
    ...(output.world?.trim() ? { world: output.world.trim() } : {}),
  };
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
    ...(made.source ? { source: made.source } : {}),
    alt: made.alt.trim(),
    ...(made.caption ? { caption: made.caption.trim() } : {}),
    ...(keepNotes && made.notes?.trim() ? { notes: made.notes.trim() } : {}),
  };
}
// 한 층을 마친 뒤: 같은 그림의 다음 층 → 다음 그림의 첫 층 → 사람 확인
// shortcut: 그리기가 한 층(FIGURE_PASSES)이 된 뒤에도 층 사이 인계(passDrafts·previous)를 남겨 둠, 층을 다시 나누지 않기로 확정되면 제거 검토
function advanceFigure(state, output) {
  const figure = state.figure;
  const { ids, pass } = currentOf(figure);
  const nextPass =
    pass === FIGURE_FIX_PASS ? undefined : FIGURE_PASSES[FIGURE_PASSES.indexOf(pass) + 1];
  const {
    draft: _draft,
    current: _current,
    pass: _pass,
    drafts: _drafts,
    passDrafts: _passDrafts,
    ...rest
  } = figure;
  if (nextPass) {
    state.figure = {
      ...rest,
      current: { ids, pass: nextPass },
      passDrafts: Object.fromEntries(
        ids.map((id) => [id, acceptFigure(figure, id, output, { keepNotes: true })]),
      ),
    };
    return;
  }
  const made = [
    ...(figure.items ?? []),
    ...ids.map((id) => acceptFigure(figure, id, output, { keepNotes: false })),
  ];
  const items = figure.selected.flatMap((sid) => made.filter((item) => item.id === sid));
  const next = pendingIds(figure, items);
  if (next.length) {
    state.figure = { ...rest, items, current: { ids: next, pass: FIGURE_PASSES[0] } };
    return;
  }
  state.figure = { ...rest, phase: "review", items };
  state.status = "awaiting_figure_review";
}
const ordered = (ids, pool) => pool.filter((id) => ids.includes(id));
const feedbackText = (value) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= FIGURE_LIMITS.feedback;
// 다시 구성: 고른 자리 전부면 세계·계약도 새로, 일부면 나머지 구성과 세계·계약을 유지 · ADR-0026
function recompose(figure, targets, feedback) {
  const {
    current: _current,
    draft: _draft,
    passDrafts: _passDrafts,
    recompose: _old,
    ...rest
  } = figure;
  const all = targets.length === figure.selected.length;
  return { ...rest, phase: "compose", feedback, ...(all ? {} : { recompose: targets }) };
}
// 사람이 후보마다 덧붙인 그림 방향 · 고른 후보에만 남기고 빈 값은 방향 없음 · ADR-0023
function withDirections(candidates, selected, directions = {}) {
  return candidates.map(({ direction: _old, ...candidate }) => {
    const direction = selected.includes(candidate.id) ? directions[candidate.id]?.trim() : "";
    return direction ? { ...candidate, direction } : candidate;
  });
}
function withRoutes(candidates, selected, routes = {}) {
  return candidates.map(({ route: _old, ...candidate }) => {
    const route = selected.includes(candidate.id) ? routes[candidate.id] : undefined;
    return route ? { ...candidate, route } : candidate;
  });
}

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
          (event.stage !== "figure" ||
            ((event.pass ?? FIGURE_PASSES[0]) === passOf(figure) &&
              sameBatch(event, currentOf(figure).ids))),
        "Unexpected or stale figure result",
      );
      const output = figureOutputSchemas[event.stage].parse(event.output);
      if (event.stage === "figure_compose") {
        state.figure = { ...acceptDesigns(figure, output), phase: "design" };
        state.status = "awaiting_figure_design";
      } else if (event.stage === "figure_plan") {
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
      const { world: _world, style: _style, motifs: _motifs, look: _look, ...fresh } = figure;
      state.figure = {
        ...fresh,
        ...(event.look ? { look: event.look } : {}),
        phase: "compose",
        candidates: withRoutes(
          withDirections(figure.candidates, selected, event.directions),
          selected,
          event.routes,
        ),
        selected,
      };
      state.status = FIGURE_WAITING;
      return true;
    }
    case "approve_design": {
      requireThat(
        state.status === "awaiting_figure_design" && reviewed,
        "Design approval requires the current design",
      );
      const pending = pendingIds(figure);
      requireThat(pending.length, "No figure left to generate");
      state.figure = {
        ...figure,
        phase: "generate",
        candidates: event.directions
          ? withDirections(figure.candidates, figure.selected, event.directions)
          : figure.candidates,
        current: { ids: pending, pass: FIGURE_PASSES[0] },
      };
      state.status = FIGURE_WAITING;
      return true;
    }
    case "revise_design": {
      const targets = event.figures ?? figure?.selected;
      requireThat(
        state.status === "awaiting_figure_design" &&
          reviewed &&
          feedbackText(event.feedback) &&
          subset(targets, figure.selected),
        "Design revision requires feedback on selected figures",
      );
      state.figure = recompose(figure, targets, event.feedback.trim());
      state.status = FIGURE_WAITING;
      return true;
    }
    case "revise_figures": {
      const made = figure?.items?.map((item) => item.id) ?? [];
      requireThat(
        state.status === "awaiting_figure_review" &&
          reviewed &&
          feedbackText(event.feedback) &&
          FIGURE_REVISE_TARGETS.includes(event.target) &&
          subset(event.figures, made),
        "Figure revision requires feedback on prepared figures",
      );
      const fixing = event.target === FIGURE_FIX_PASS;
      const fixes = (id) => figure.candidates.find((c) => c.id === id)?.fixes ?? 0;
      requireThat(
        !fixing || (event.figures.length === 1 && fixes(event.figures[0]) < FIGURE_LIMITS.fixes),
        "Figure fix takes one figure within the fix limit",
      );
      const feedback = event.feedback.trim();
      const items = figure.items.filter((item) => !event.figures.includes(item.id));
      if (event.target === "compose") {
        state.figure = {
          ...recompose(figure, ordered(event.figures, figure.selected), feedback),
          items,
        };
      } else {
        // 국소 수정: 직전 그림을 출발점으로 지적만 고친다 · ADR-0026
        const [id] = event.figures;
        state.figure = {
          ...figure,
          items,
          phase: "generate",
          candidates: figure.candidates.map((c) =>
            c.id === id ? { ...c, fix: feedback, fixes: fixes(id) + 1 } : c,
          ),
          current: { ids: [id], pass: FIGURE_FIX_PASS },
          passDrafts: { [id]: figure.items.find((item) => item.id === id) },
        };
      }
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

// 본문에 놓인 그림 · 그림 파일 제공과 본문 표시가 같은 자리 규칙(figureSpots)을 쓴다
export const placedFigures = (state) =>
  figureSpots(state.figure).flatMap((spot) => (spot.item ? [spot.item] : []));
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
// 고른 자리가 있고 아직 확정되지 않은 단계 · 이 밖(제안 중·버림)에는 놓을 자리가 없다
const SELECTED_PHASES = new Set(["compose", "design", "generate", "review"]);
// 본문에 놓을 그림 자리 · 그림이 있으면 그림, 없으면 고른 자리와 그 상태(FIGURE_SPOTS) · FIGURE-001
// 위치 고르기는 모든 후보, 확정 전 단계는 고른 자리 전부, 확정 뒤는 남긴 그림만 · busy: 실제 AI 작업 진행 여부
/** @returns {Array<{ id: string, anchor: string, item?: object, spot?: string }>} */
export function figureSpots(figure, busy = false) {
  if (figure?.phase === "choose")
    return (figure.candidates ?? []).map((candidate) => ({ ...candidate, spot: "candidate" }));
  const items = figure?.items ?? [];
  if (figure?.phase === "confirmed") return items.map((item) => ({ ...item, item }));
  if (!SELECTED_PHASES.has(figure?.phase)) return [];
  const drawn = new Map(items.map((item) => [item.id, item]));
  const candidates = new Map(figure.candidates.map((candidate) => [candidate.id, candidate]));
  const working = new Set(figure.phase === "generate" ? currentOf(figure).ids : []);
  const spotOf = (id) => {
    if (figure.phase === "compose") return busy ? "composing" : "stopped";
    if (figure.phase === "design") return "design";
    if (!working.has(id)) return "queued";
    return busy ? "drawing" : "stopped";
  };
  return figure.selected.flatMap((id) => {
    const item = drawn.get(id);
    if (item) return [{ ...item, item }];
    const candidate = candidates.get(id);
    return candidate ? [{ ...candidate, spot: spotOf(id) }] : [];
  });
}
