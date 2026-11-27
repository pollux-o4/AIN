package editorial

import "encoding/json"

type activityEvent struct {
	At       int64  `json:"at"`
	Kind     string `json:"kind"`
	Label    string `json:"label"`
	Revision int64  `json:"revision"`
	Stage    string `json:"stage,omitempty"`
	Reason   string `json:"reason,omitempty"`
	JobID    string `json:"jobId,omitempty"`
}

type pipelineStep struct {
	Stage       string `json:"stage"`
	Name        string `json:"name"`
	Status      string `json:"status"`
	StartedAt   *int64 `json:"startedAt"`
	CompletedAt *int64 `json:"completedAt"`
}

func pipeline(stage, status string, revision int64, artifacts []artifactView, events []activityEvent) []pipelineStep {
	active := map[string]string{"waiting_ai": "active", "waiting_route": "active", "paused": "paused", "failed": "failed"}[status]
	stages := writingStages
	if status == "waiting_route" {
		stages = append([]struct{ key, name string }{{"route", "수정 위치 확인"}}, stages...)
		stage = "route"
	}
	steps := make([]pipelineStep, 0, len(stages))
	for _, definition := range stages {
		step := pipelineStep{Stage: definition.key, Name: definition.name, Status: "pending"}
		if stage == definition.key && active != "" {
			step.Status = active
		}
		for _, artifact := range artifacts {
			if artifact.Stage == definition.key {
				step.Status = "done"
				break
			}
		}
		for _, event := range events {
			if event.Revision != revision || event.Stage != definition.key {
				continue
			}
			if event.Kind == "ai_requested" {
				step.StartedAt = &event.At
			}
			if event.Kind == "ai_completed" && step.Status == "done" {
				step.CompletedAt = &event.At
			}
		}
		steps = append(steps, step)
	}
	return steps
}

func publicEvents(raw json.RawMessage) []activityEvent {
	if raw == nil {
		return []activityEvent{}
	}
	var events []activityEvent
	_ = json.Unmarshal(raw, &events)
	result := make([]activityEvent, 0, len(events))
	for _, e := range events {
		if e.Label != "" && e.At > 0 && e.Revision > 0 {
			result = append(result, e)
		}
	}
	return result
}
