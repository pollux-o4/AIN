package editorial

import "slices"

type pipelineStep struct {
	Stage       string `json:"stage"`
	Name        string `json:"name"`
	Status      string `json:"status"`
	StartedAt   *int64 `json:"startedAt"`
	CompletedAt *int64 `json:"completedAt"`
}

func pipeline(state publicRunState, artifacts []artifactView, events []monitorEvent, blocked bool) []pipelineStep {
	current := ""
	if !blocked {
		current = map[string]string{"waiting_ai": "active", "waiting_figure": "active", "paused": "paused", "failed": "failed"}[state.Status]
	}
	status := func(stage, working string, done bool) string {
		if done {
			return "done"
		}
		if stage == working && current != "" {
			return current
		}
		return "pending"
	}
	step := func(stage, status string) pipelineStep {
		result := pipelineStep{Stage: stage, Name: monitorStageName(stage), Status: status}
		for _, event := range events {
			if event.Revision != state.Revision || event.Stage != stage {
				continue
			}
			if event.Kind == "ai_requested" {
				result.StartedAt = &event.At
			}
			if event.Kind == "ai_completed" && status == "done" {
				result.CompletedAt = &event.At
			}
		}
		return result
	}
	result := make([]pipelineStep, 0, len(writingStages)+4)
	if state.Status == "waiting_route" {
		routeState := "active"
		if blocked {
			routeState = "pending"
		}
		result = append(result, step("route", routeState))
	}
	for _, stage := range writingStages {
		done := slices.ContainsFunc(artifacts, func(artifact artifactView) bool { return artifact.Stage == stage.key })
		result = append(result, step(stage.key, status(stage.key, state.Stage, done)))
	}
	if phase, _ := state.Figure["phase"].(string); phase != "" {
		working := displayWorkStage(state)
		result = append(result,
			step("figure_plan", status("figure_plan", working, phase != "propose")),
			step("figure_compose", status("figure_compose", working, slices.Contains([]string{"design", "generate", "review", "confirmed"}, phase))),
			step("figure", status("figure", working, phase == "review" || phase == "confirmed")),
		)
	}
	return result
}
