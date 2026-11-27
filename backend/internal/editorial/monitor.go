package editorial

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

type activityEvent struct {
	By          string  `json:"by,omitempty"`
	At          int64   `json:"at"`
	Kind        string  `json:"kind"`
	Label       string  `json:"label"`
	Revision    int64   `json:"revision"`
	Stage       string  `json:"stage,omitempty"`
	Reason      string  `json:"reason,omitempty"`
	JobID       string  `json:"jobId,omitempty"`
	ExecutionID *string `json:"executionId,omitempty"`
}

type monitorEvent struct {
	activityEvent
	ExecutionID *string `json:"executionId"`
}

type detailMonitor struct {
	Kind             string         `json:"kind"`
	Label            string         `json:"label"`
	Now              int64          `json:"now"`
	LastConfirmedAt  *int64         `json:"lastConfirmedAt"`
	ExecutionID      *string        `json:"executionId"`
	CanPause         bool           `json:"canPause"`
	CanResume        bool           `json:"canResume"`
	ResumeLabel      string         `json:"resumeLabel"`
	NeedsAiAttention bool           `json:"needsAiAttention"`
	Events           []monitorEvent `json:"events"`
	Pipeline         []pipelineStep `json:"pipeline"`
}

type pendingRunReader interface {
	PendingRun(context.Context, string) (contract.Intent, error)
}

func (q Queries) monitor(ctx context.Context, id string, run publicRunRecord, needsCompletion, held bool) (detailMonitor, error) {
	stage := displayWorkStage(run.State)
	now := q.now().UnixMilli()
	running := run.Pending != nil && run.Pending.JobID != ""
	var managed bool
	// A bound client message identifies an observed (as opposed to merely
	// reserved) Go turn. Legacy rows retain their saved worker observation.
	if reader, ok := q.Store.(pendingRunReader); ok && isPending(run.State.Status) && !held && !needsCompletion {
		intent, err := reader.PendingRun(ctx, id)
		switch {
		case err == nil:
			managed = true
			running = intent.Remote.AgentID != "" && intent.Remote.TurnID != ""
		case !errors.Is(err, contract.ErrNotFound):
			return detailMonitor{}, err
		}
	}
	events := make([]monitorEvent, 0)
	for _, event := range publicEvents(run.Events) {
		events = append(events, monitorEvent{activityEvent: event, ExecutionID: event.ExecutionID})
	}
	monitor := detailMonitor{
		Now: now, LastConfirmedAt: run.Worker.ConfirmedAt, ExecutionID: run.Worker.ExecutionID,
		CanPause: isPending(run.State.Status) && !held, ResumeLabel: "이어가기", Events: events,
	}
	lastAt := firstDetailTime(run.Worker.ConfirmedAt, run.QueuedAt, run.StartedAt)
	switch {
	case held:
		monitor.Kind, monitor.Label = "blocked", "이전 AI 작업 확인 대기"
	case needsCompletion:
		monitor.Kind, monitor.Label = "blocked", "요구사항 보완 필요"
	case run.State.Status == "satisfied":
		monitor.Kind, monitor.Label = "ready", "초안 확정"
		if run.State.Figure != nil {
			monitor.Label = "시각자료 확인됨"
		}
	default:
		if label := readyLabels[run.State.Status]; label != "" {
			monitor.Kind, monitor.Label = "ready", label
		} else {
			switch {
			case run.State.Status == "paused":
				monitor.Kind, monitor.Label = "paused", "중단됨"
			case run.State.Status == "failed":
				monitor.Kind, monitor.Label = "failed", "실패"
			case run.Issue != nil && *run.Issue != "":
				monitor.Kind, monitor.Label = "blocked", "확인 필요"
			case !managed && lastAt != nil && now-*lastAt > 15000:
				monitor.Kind, monitor.Label = "stale", "진행 확인 지연"
			case running:
				monitor.Kind, monitor.Label = "working", displayWorkName(run.State, stage)+" 중"
			default:
				monitor.Kind, monitor.Label = "queued", displayWorkName(run.State, stage)+" 대기"
			}
		}
	}
	monitor.CanResume = !held && !needsCompletion &&
		slices.Contains([]string{"paused", "failed", "stale", "blocked"}, monitor.Kind)
	if monitor.Kind == "stale" {
		monitor.ResumeLabel = "진행 다시 연결"
	} else if monitor.Kind == "blocked" {
		monitor.ResumeLabel = "상태 다시 확인"
	}
	if detail := rawText(run.IssueKind); detail != nil && monitor.Kind == "blocked" {
		monitor.NeedsAiAttention = slices.Contains([]string{"ai_attention", "ai_connection", "stop_unconfirmed"}, *detail)
	}
	return monitor, nil
}

var readyLabels = map[string]string{
	"publication_ready":      "발행 준비 승인",
	"awaiting_figure_choice": "시각자료 위치 선택 대기",
	"awaiting_figure_design": "시각자료 구성 확인 대기",
	"awaiting_figure_review": "시각자료 확인 대기",
	"awaiting_brief":         "수정 해석 확인 대기",
	"awaiting_user":          "초안 준비됨",
}

func firstDetailTime(values ...*int64) *int64 {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func displayWorkStage(state publicRunState) string {
	status := state.Status
	if status == "paused" || status == "failed" {
		status = state.ResumeStatus
	}
	if status == "waiting_figure" {
		switch state.Figure["phase"] {
		case "compose":
			return "figure_compose"
		case "generate":
			return "figure"
		default:
			return "figure_plan"
		}
	}
	if state.Status == "waiting_route" {
		return "route"
	}
	return state.Stage
}

func monitorStageName(key string) string {
	for _, stage := range writingStages {
		if stage.key == key {
			return stage.name
		}
	}
	switch key {
	case "route":
		return "수정 위치 확인"
	case "figure_plan":
		return "시각자료 위치 제안"
	case "figure_compose":
		return "시각자료 구성"
	case "figure":
		return "시각자료 생성"
	default:
		return key
	}
}

func displayWorkName(state publicRunState, stage string) string {
	name := monitorStageName(stage)
	if stage != "figure" || state.Figure["phase"] != "generate" {
		return name
	}
	current, _ := state.Figure["current"].(map[string]any)
	ids, _ := current["ids"].([]any)
	if len(ids) == 0 && current["id"] != nil {
		ids = append(ids, current["id"])
	}
	if current["pass"] == "fix" {
		return fmt.Sprintf("%s %d장 동시 · 부분 수정", name, len(ids))
	}
	return fmt.Sprintf("%s %d장 동시 · 그리기 1/1", name, len(ids))
}

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
