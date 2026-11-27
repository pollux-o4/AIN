package editorial

import (
	"context"
	"encoding/json"
	"strconv"
)

func (q Queries) HistoryView(ctx context.Context, id string) (json.RawMessage, error) {
	data, err := q.Run(ctx, id)
	if err != nil {
		return nil, err
	}
	var run publicRunRecord
	if err := json.Unmarshal(data, &run); err != nil {
		return nil, err
	}

	events := publicEvents(run.Events)
	records := make([]map[string]any, 0, len(events))
	var elapsed int64
	starts := make(map[string]int64)
	for index, event := range events {
		name := event.Stage
		for _, stage := range writingStages {
			if stage.key == event.Stage {
				name = stage.name
				break
			}
		}
		var output map[string]json.RawMessage
		source := "none"
		if event.Kind == "ai_completed" && event.Revision == run.State.Revision {
			var artifact artifactView
			if json.Unmarshal(run.State.Artifacts[event.Stage], &artifact) == nil && artifact.Revision == event.Revision {
				output, source = artifact.Output, "artifact"
			}
		}
		if event.JobID != "" {
			if event.Kind == "ai_requested" {
				starts[event.JobID] = event.At
			} else if start, found := starts[event.JobID]; found {
				elapsed += max(0, event.At-start)
				delete(starts, event.JobID)
			}
		}
		var reason any
		if event.Reason != "" {
			reason = event.Reason
		}
		records = append(records, map[string]any{
			"key": strconv.Itoa(index), "at": event.At, "kind": event.Kind, "label": event.Label,
			"revision": event.Revision, "stage": event.Stage, "name": name, "goal": "",
			"inputs": []string{}, "inputsSource": "unavailable", "model": nil, "executionId": event.ExecutionID,
			"output": output, "resultSource": source, "target": nil, "reason": reason,
			"unavailable": event.JobID != "" && output == nil, "steps": []any{},
		})
	}
	journey := make([]map[string]any, 0, len(run.State.History)+1)
	for _, revision := range run.State.History {
		journey = append(journey, historyEntry(revision.Revision, revision.Artifacts.Draft, nil))
	}
	var draft *draftArtifact
	_ = json.Unmarshal(run.State.Artifacts["draft"], &draft)
	_, findings := projectArtifacts(run.State.Artifacts, run.State.Revision, true)
	journey = append(journey, historyEntry(run.State.Revision, draft, findings))
	return json.Marshal(map[string]any{
		"journey": journey, "records": records,
		"usage": map[string]any{"ms": elapsed, "tokens": nil, "calls": run.CallsUsed,
			"wasted": 0, "revisions": []any{}, "hotspots": []any{}},
	})
}

func historyEntry(revision int64, draft *draftArtifact, findings []string) map[string]any {
	if findings == nil {
		findings = []string{}
	}
	return map[string]any{
		"revision": revision, "hasDraft": draft != nil && draft.Output.Text != "",
		"request": nil, "direction": []any{}, "summary": nil, "findings": findings,
	}
}
