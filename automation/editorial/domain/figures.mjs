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
import { HUMAN_EDITS } from "./figure-human.mjs";
import { anchorSection } from "./figure-placement.mjs";
import { currentOf, passOf, pendingIds } from "./figure-progress.mjs";

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
  "place_figure",
  "remove_figure",
  "approve_design",
  "revise_design",
  "revise_figures",
  "retry_figures",
  "confirm_figures",
  "discard_figures",
]);
function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}
// 고른 id를 기준 목록 순서로 · 한 번 색인해 O(n+m)
const ordered = (ids, pool) => {
  const wanted = new Set(ids);
  return pool.filter((id) => wanted.has(id));
};
const omit = (object, keys) =>
  Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));
// 생성 진행 중에만 뜻이 있는 상태(지금 묶음·층 사이 인계, 묶음 도입 전 모양 포함) · 단계를 옮길 때 함께 지운다
const PROGRESS_KEYS = ["current", "draft", "pass", "drafts", "passDrafts"];
// 구성이 정한 글 전체 일관성 계약 · 새로 고르면 다시 정한다 · ADR-0022·ADR-0027
const CONSISTENCY_KEYS = ["world", "style", "motifs", "look"];
// 실패 기록(그림 id → 사유) · 비면 키를 남기지 않는다 · ADR-0026
const withFailures = (figure, failed) => {
  const rest = omit(figure, ["failed"]);
  return Object.keys(failed).length ? { ...rest, failed } : rest;
};
// 결과가 가리키는 묶음이 지금 묶음과 같은가 · 묶음 표시가 없는 결과는 내용(그림 id) 검사에 맡긴다
const sameBatch = (event, ids) => {
  const got = event.figureIds ?? (event.figureId ? [event.figureId] : null);
  return !got || (got.length === ids.length && got.every((id) => ids.includes(id)));
};
const draftsOf = (figure) =>
  figure.passDrafts ?? (figure.draft ? { [figure.draft.id]: figure.draft } : {});
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
    (candidates.length < 1 && figure.phase !== "choose") ||
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
  const failedIds = Object.keys(figure.failed ?? {});
  const madeIds = new Set((figure.items ?? []).map((item) => item.id));
  if (
    failedIds.length &&
    (!subset(failedIds, figure.selected) || failedIds.some((id) => madeIds.has(id)))
  )
    return "Failed figures must be selected and not prepared";
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
// 사람이 고른 그림별 스타일만 다시 구성해도 남긴다 · 구성이 고른 것은 새 구성이 다시 정한다 · ADR-0027
const withoutDesign = (candidate) =>
  Object.fromEntries(
    Object.entries(candidate).filter(
      ([key]) => !DESIGN_FIELDS.includes(key) && (key !== "look" || candidate.lookBy === "user"),
    ),
  );
// 사람이 그림마다 고른 스타일 · lookBy로 구성의 선택과 구분한다
const withLook = (candidates, ids, look) =>
  look
    ? candidates.map((c) => (ids.includes(c.id) ? { ...c, look, lookBy: "user" } : c))
    : candidates;
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
    const { analogy, scene, mapping, motifs, look } = byId.get(candidate.id);
    const kept = withoutDesign(candidate);
    return {
      ...kept,
      ...(look && !kept.look ? { look } : {}),
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
// 그림 단위 실패 · 묶음 결과가 실패한 그림 id와 사유를 함께 보낸다 · 한 장도 못 그리면 묶음 실패(fail 사건)로 처리 · ADR-0026
// 사유는 화면에 보일 짧은 문장만 남긴다(원문·세션 내용을 담지 않음)
function failuresOf(event, ids) {
  const failures = new Map(
    (event.failed ?? []).map(({ id, error }) => [id, String(error ?? "").slice(0, 200) || "실패"]),
  );
  requireThat(
    [...failures.keys()].every((id) => ids.includes(id)) && failures.size < ids.length,
    "Figure failures must be part of the batch and leave at least one figure",
  );
  return failures;
}
// 한 층을 마친 뒤: 같은 그림의 다음 층 → 다음 그림의 첫 층 → 사람 확인 · 실패한 그림은 빼고 사유를 남긴다
// shortcut: 그리기가 한 층(FIGURE_PASSES)이 된 뒤에도 층 사이 인계(passDrafts·previous)를 남겨 둠, 층을 다시 나누지 않기로 확정되면 제거 검토
function advanceFigure(state, output, failures = new Map()) {
  const figure = state.figure;
  const { ids: batch, pass } = currentOf(figure);
  const ids = batch.filter((id) => !failures.has(id));
  const drawn = new Set(ids);
  const failed = Object.fromEntries([
    ...Object.entries(figure.failed ?? {}).filter(([id]) => !drawn.has(id)),
    ...failures,
  ]);
  const nextPass =
    pass === FIGURE_FIX_PASS ? undefined : FIGURE_PASSES[FIGURE_PASSES.indexOf(pass) + 1];
  const rest = withFailures(omit(figure, PROGRESS_KEYS), failed);
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
  const made = new Map(
    [
      ...(figure.items ?? []),
      ...ids.map((id) => acceptFigure(figure, id, output, { keepNotes: false })),
    ].map((item) => [item.id, item]),
  );
  const items = figure.selected.flatMap((id) => (made.has(id) ? [made.get(id)] : []));
  const next = pendingIds(figure, items).filter((id) => !failed[id]);
  if (next.length) {
    state.figure = {
      ...rest,
      items,
      current: { ids: next, pass: FIGURE_PASSES[0] },
    };
    return;
  }
  state.figure = { ...rest, phase: "review", items };
  state.status = "awaiting_figure_review";
}
const feedbackText = (value) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= FIGURE_LIMITS.feedback;
// 다시 구성 요청은 의견이나 새 스타일 중 하나가 있으면 된다 · 스타일만 바꿀 때 의견을 지어내지 않게 · ADR-0027
const reasonGiven = (event) => feedbackText(event.feedback) || Boolean(event.look);
// 다시 구성: 고른 자리 전부면 세계·계약도 새로, 일부면 나머지 구성과 세계·계약을 유지 · ADR-0026
function recompose(figure, targets, feedback) {
  const rest = omit(figure, [...PROGRESS_KEYS, "recompose"]);
  const all = targets.length === figure.selected.length;
  return {
    ...rest,
    phase: "compose",
    ...(feedback ? { feedback } : {}),
    ...(all ? {} : { recompose: targets }),
  };
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
          skipped: output.skipped ?? [],
          coverage: coverageOf(draftText(state), candidates, output.skipped ?? []),
        };
        state.status = "awaiting_figure_choice";
      } else advanceFigure(state, output, failuresOf(event, currentOf(figure).ids));
      return true;
    }
    case "place_figure":
    case "remove_figure": {
      requireThat(
        state.status === "awaiting_figure_choice" && reviewed,
        "시각자료 위치 선택 대기 중에만 자리를 바꿀 수 있습니다.",
      );
      const text = draftText(state);
      const candidates = HUMAN_EDITS[event.type](figure.candidates, event, text);
      state.figure = {
        ...figure,
        candidates,
        coverage: coverageOf(text, candidates, figure.skipped ?? []),
      };
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
        ...omit(figure, CONSISTENCY_KEYS),
        ...(event.look ? { look: event.look } : {}),
        phase: "compose",
        candidates: withRoutes(
          withDirections(
            figure.candidates.map(({ look: _look, lookBy: _by, ...c }) => c),
            selected,
            event.directions,
          ),
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
          reasonGiven(event) &&
          subset(targets, figure.selected),
        "Design revision requires feedback on selected figures",
      );
      state.figure = recompose(
        { ...figure, candidates: withLook(figure.candidates, targets, event.look) },
        targets,
        event.feedback?.trim(),
      );
      state.status = FIGURE_WAITING;
      return true;
    }
    case "revise_figures": {
      const made = figure?.items?.map((item) => item.id) ?? [];
      requireThat(
        state.status === "awaiting_figure_review" &&
          reviewed &&
          (event.target === FIGURE_FIX_PASS ? feedbackText(event.feedback) : reasonGiven(event)) &&
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
      const feedback = event.feedback?.trim();
      const items = figure.items.filter((item) => !event.figures.includes(item.id));
      if (event.target === "compose") {
        const targets = ordered(event.figures, figure.selected);
        state.figure = {
          ...recompose(
            { ...figure, candidates: withLook(figure.candidates, targets, event.look) },
            targets,
            feedback,
          ),
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
    // 실패한 그림만 다시 그린다 · 끝난 그림은 그대로 둔다 · ADR-0026
    case "retry_figures": {
      const failed = Object.keys(figure?.failed ?? {});
      requireThat(
        state.status === "awaiting_figure_review" &&
          reviewed &&
          event.figures?.length > 0 &&
          subset(event.figures, failed),
        "Figure retry requires failed figures",
      );
      const ids = ordered(event.figures, figure.selected);
      state.figure = {
        ...withFailures(omit(figure, PROGRESS_KEYS), omit(figure.failed, ids)),
        phase: "generate",
        current: { ids, pass: FIGURE_PASSES[0] },
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
        ...omit(figure, ["failed"]),
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
