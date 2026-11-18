import { modelLabel } from "../../contracts/ai-models.mjs";
import { describeChange, describeRequirement } from "../../contracts/requirements.mjs";
import { sectionMode, sectionTitle } from "../../contracts/writing-modes.mjs";
import { blockingUnmet, flowIssue, STAGES, standing } from "../domain/index.mjs";
import { currentArtifact, runMonitor, stageName } from "../monitor.mjs";
import { figureView } from "./figures.mjs";
import { COMPLETION_REASON } from "./lifecycle.mjs";

export const completionNotice = (state) => (flowIssue(state) ? COMPLETION_REASON : null);
// 사람에게 내놓은 결과: 검토를 마친 초안 · 확정된 초안은 시각자료 작업 중(대기·중단·실패)에도 그대로
export const presented = (state) =>
  ["awaiting_user", "satisfied", "publication_ready"].includes(state.status) ||
  (state.figure !== undefined && state.satisfiedRevision === state.revision);
// 사람 입력을 받을 수 있는 상태: 내놓은 결과이고 AI 작업·중단·실패가 아님
const settled = (state) =>
  presented(state) && !["waiting_figure", "paused", "failed"].includes(state.status);
const draftOf = (entry) => {
  const draft = entry?.artifacts?.draft;
  return typeof draft?.output?.text === "string"
    ? { text: draft.output.text, revision: draft.revision ?? entry.revision }
    : null;
};
export const displayedDraft = (state) =>
  draftOf(state) ??
  (state.history ?? []).map(draftOf).findLast(Boolean) ?? { text: "", revision: null };
export function titleOf(run) {
  const draft = displayedDraft(run.state).text;
  const title = draft.match(/^#\s+(.+)$/m)?.[1] ?? (run.state.idea ?? "").split("\n")[0];
  return title.length > 100 ? `${title.slice(0, 100)}…` : title;
}
function designOf(state) {
  // 서술 방식·독자 수준: 요구 장부 값이면 사용자, 아니면 진단 판단 · ADR-0016
  const required = standing(state);
  const diagnose = currentArtifact(state, "diagnose")?.output;
  const outline = currentArtifact(state, "outline")?.output;
  const userMode = required.mode?.value;
  const userLevel = required.readerLevel?.value;
  return {
    mode: userMode ?? diagnose?.primaryMode ?? null,
    modeBy: userMode ? "user" : diagnose?.primaryMode ? "ai" : null,
    readerLevel: userLevel ?? diagnose?.readerLevel ?? null,
    levelBy: userLevel ? "user" : diagnose?.readerLevel ? "ai" : null,
    sections: (outline?.sections ?? []).map((section) => ({
      title: sectionTitle(section),
      mode: sectionMode(section),
    })),
  };
}
export function runView(run, now) {
  const state = run.state;
  const completionReason = completionNotice(state);
  const needsCompletion = completionReason !== null;
  const monitor = runMonitor(run, now);
  const draft = displayedDraft(state);
  return {
    id: run.id,
    version: state.version,
    revision: state.revision,
    idea: state.idea,
    title: titleOf(run),
    source: state.source,
    design: designOf(state),
    status: state.status,
    busy: ["queued", "working"].includes(monitor.kind),
    stage: state.stage,
    label: monitor.label,
    monitor,
    issue: run.issue ?? completionReason ?? state.error ?? null,
    needsCompletion,
    completionReason,
    canCompleteRequirements: needsCompletion,
    text: draft.text,
    textRevision: draft.revision,
    artifacts: STAGES.flatMap((stage) => {
      const artifact = currentArtifact(state, stage);
      return artifact
        ? [
            {
              stage,
              name: stageName(stage),
              revision: artifact.revision,
              output: artifact.output,
              ...(artifact.reusedFromRevision === undefined
                ? {}
                : { reusedFromRevision: artifact.reusedFromRevision }),
            },
          ]
        : [];
    }),
    findings: presented(state) ? (state.artifacts?.review?.output?.findings ?? []) : [],
    // 코드 판정 요구사항 중 자동 재작성 후에도 남은 것 · ADR-0007
    unmetRequirements: presented(state) ? (state.unmet ?? []).map((u) => u.message) : [],
    // 편집 메모: 사람 피드백을 편집장이 해석한 결과 · 잘못 해석됐으면 사람이 다시 요청 · ADR-0008
    brief: state.brief
      ? {
          ...state.brief,
          requirementChanges: (state.brief.requirementChanges ?? []).map(describeChange),
        }
      : null,
    // 지금 유효한 요구(요구 장부) · 화면·CLI 표시용 한 줄씩
    requirements: Object.entries(standing(state)).map(([kind, { value }]) =>
      describeRequirement(kind, value),
    ),
    previous: (state.history ?? []).map((h) => ({
      revision: h.revision,
      text: h.artifacts?.draft?.output?.text ?? "",
      status: h.status ?? null,
      stage: h.stage ?? null,
      needsCompletion: Boolean(h.completionReason),
      reviewed: h.reviewed ?? null,
    })),
    canDownload:
      Boolean(draft.text) &&
      (draft.revision !== state.revision || presented(state) || needsCompletion),
    canFeedback: settled(state) && !needsCompletion,
    // 코드로 판정한 요구사항(분량 등) 미충족이면 만족 승인 불가 · ADR-0007
    canSatisfy:
      state.status === "awaiting_user" && !needsCompletion && !blockingUnmet(state).length,
    // 수정 해석 승인 게이트 · 승인 전에는 수정 루프를 시작하지 않음 · ADR-0010
    canApproveBrief: state.status === "awaiting_brief" && !needsCompletion,
    // 시각자료(선택 단계) · 본문·확정은 그대로 · 준비(후보·생성물)와 사람 확인을 구분 · FIGURE-001
    figure: figureView(state),
    canRequestFigures: state.status === "satisfied" && !state.figure && !needsCompletion,
    canSelectFigures: state.status === "awaiting_figure_choice" && !needsCompletion,
    canConfirmFigures: state.status === "awaiting_figure_review" && !needsCompletion,
    canDiscardFigures:
      Boolean(state.figure) && settled(state) && state.status !== "publication_ready",
    canAuthorizePublication:
      state.status === "satisfied" &&
      state.satisfiedRevision === state.revision &&
      !needsCompletion,
    updatedAt: run.updatedAt,
    archived: Boolean(run.archivedAt),
    model: modelLabel(run.ai.model),
    callsUsed: run.callsUsed,
    maxCalls: run.maxCalls,
    appliedOperations: Object.keys(run.operations ?? {}),
  };
}
