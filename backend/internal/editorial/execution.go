package editorial

import (
	"encoding/json"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

// ExecutionRules records confirmed outcomes alongside the transition being
// committed. Human commands continue to use the same underlying rules.
type ExecutionRules struct {
	contract.EditorialRules
	Now func() time.Time
}

func (r ExecutionRules) Reduce(run contract.Run, event contract.Event) (contract.Run, error) {
	next, err := r.EditorialRules.Reduce(run, event)
	if err != nil || event.Actor != "adapter" || next.Version == run.Version {
		return next, err
	}
	var prior struct {
		State struct {
			Revision int64
			Stage    string
		}
	}
	var payload struct{ Stage string }
	if err := json.Unmarshal(run.Value, &prior); err != nil {
		return run, err
	}
	_ = json.Unmarshal(event.Body, &payload)
	if payload.Stage == "" {
		payload.Stage = prior.State.Stage
	}
	kind, label := "ai_completed", "AI 작업 완료"
	if event.Kind == "fail" {
		kind, label = "failed", "AI 작업 실패"
	}
	var record map[string]json.RawMessage
	if err := json.Unmarshal(next.Value, &record); err != nil {
		return run, err
	}
	now := r.Now().UnixMilli()
	if err := appendStoredActivity(record, activityEvent{At: now, Kind: kind, Label: label,
		Revision: prior.State.Revision, Stage: payload.Stage, JobID: event.ID}, event.Usage); err != nil {
		return run, err
	}
	next.Value, err = json.Marshal(record)
	return next, err
}

func appendActivity(record map[string]json.RawMessage, activity activityEvent) error {
	return appendStoredActivity(record, activity, nil)
}

func appendStoredActivity(record map[string]json.RawMessage, activity activityEvent, usage *contract.TurnUsage) error {
	var events []json.RawMessage
	if existing := record["events"]; existing != nil {
		if err := json.Unmarshal(existing, &events); err != nil {
			return err
		}
	}
	if activity.Kind != "ai_completed" || activity.JobID == "" || !usage.Valid() {
		usage = nil
	}
	event, err := json.Marshal(struct {
		activityEvent
		Usage *contract.TurnUsage `json:"usage,omitempty"`
	}{activityEvent: activity, Usage: usage})
	if err != nil {
		return err
	}
	record["events"], err = json.Marshal(append(events, event))
	if err != nil {
		return err
	}
	record["updatedAt"], _ = json.Marshal(activity.At)
	return nil
}
