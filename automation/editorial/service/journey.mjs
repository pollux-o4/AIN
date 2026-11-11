import { sectionTitle } from "../../contracts/writing-modes.mjs";
import { currentArtifact } from "../domain/index.mjs";

function directionOf(snapshot) {
  const output = (stage) => currentArtifact(snapshot, stage)?.output ?? {};
  const audience = output("audience"),
    topic = output("topic"),
    value = output("value"),
    outline = output("outline");
  return [
    { label: "독자", text: audience.reader, reason: audience.intent },
    { label: "핵심", text: value.outcome ?? topic.problem, reason: topic.scope },
    {
      label: "구성",
      text: outline.sections?.map(sectionTitle).join(" → "),
      reason: outline.rationale,
    },
  ]
    .filter((choice) => typeof choice.text === "string" && choice.text.trim())
    .map((choice) => ({
      ...choice,
      reason: typeof choice.reason === "string" ? choice.reason : null,
    }));
}

// Present saved editorial choices, not inferred model reasoning or operational chatter.
export function writingJourney(state, records) {
  const snapshots = [...(state.history ?? []), state].filter(
    (snapshot) => Number.isSafeInteger(snapshot.revision) && snapshot.revision > 0,
  );
  return snapshots.map((snapshot, index) => {
    const output = (stage) => currentArtifact(snapshot, stage)?.output ?? {};
    const fullDirection = directionOf(snapshot);
    const previousDirection = index > 0 ? directionOf(snapshots[index - 1]) : [];
    const direction = fullDirection.filter(
      (choice) =>
        !previousDirection.some(
          (before) =>
            before.label === choice.label &&
            before.text === choice.text &&
            before.reason === choice.reason,
        ),
    );
    const previous = snapshots[index - 1];
    const requestEvent = records.find(
      (record) =>
        record.revision === snapshot.revision &&
        ["feedback", "complete_requirements"].includes(record.kind),
    );
    const request =
      snapshot.revision === 1
        ? null
        : (requestEvent?.reason ?? previous?.feedback ?? requestEvent?.label ?? null);
    const draft = output("draft"),
      review = output("review"),
      research = output("research");
    const findings = [
      ...new Set([...(review.findings ?? []), ...(research.uncertainties ?? [])]),
    ].filter((item) => typeof item === "string" && item.trim());
    return {
      revision: snapshot.revision,
      request,
      direction,
      summary: typeof draft.changeSummary === "string" ? draft.changeSummary : null,
      findings,
      hasDraft:
        typeof snapshot.artifacts?.draft?.output?.text === "string" &&
        Boolean(snapshot.artifacts.draft.output.text),
    };
  });
}
