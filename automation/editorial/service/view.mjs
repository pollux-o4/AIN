import {
  AUTO,
  DEFAULT_DIRECTION,
  directionSchema,
  sectionMode,
  sectionTitle,
} from "../../contracts/writing-modes.mjs";
import { flowIssue, STAGES } from "../domain/index.mjs";
import { currentArtifact, runMonitor, stageName } from "../monitor.mjs";
import { COMPLETION_REASON, DEFAULT_AI } from "./lifecycle.mjs";

export const completionNotice = (state) => (flowIssue(state) ? COMPLETION_REASON : null);
export const presented = (state) =>
  ["awaiting_user", "satisfied", "publication_ready"].includes(state.status);
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
  const parsed = directionSchema.safeParse(state.direction);
  const direction = parsed.success ? parsed.data : DEFAULT_DIRECTION;
  const diagnose = currentArtifact(state, "diagnose")?.output;
  const outline = currentArtifact(state, "outline")?.output;
  const userMode = direction.mode !== AUTO;
  const userLevel = direction.readerLevel !== AUTO;
  return {
    mode: userMode ? direction.mode : (diagnose?.primaryMode ?? null),
    modeBy: userMode ? "user" : diagnose?.primaryMode ? "ai" : null,
    readerLevel: userLevel ? direction.readerLevel : (diagnose?.readerLevel ?? null),
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
    canFeedback: presented(state) && !needsCompletion,
    canSatisfy: state.status === "awaiting_user" && !needsCompletion,
    canAuthorizePublication:
      state.status === "satisfied" &&
      state.satisfiedRevision === state.revision &&
      !needsCompletion,
    updatedAt: run.updatedAt,
    model: run.ai.model === DEFAULT_AI.model ? "Flash 3.8 Medium" : run.ai.model,
    callsUsed: run.callsUsed,
    maxCalls: run.maxCalls,
    appliedOperations: Object.keys(run.operations ?? {}),
  };
}
