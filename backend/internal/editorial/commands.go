package editorial

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/runner"
	"github.com/pollux-o4/AIN/backend/internal/writing"
)

type Commands struct {
	Store     contract.Store
	Rules     contract.EditorialRules
	Scheduler contract.Scheduler
}

var commandSignatureFields = []string{
	"figure", "quote", "claim", "expectedVersion", "type", "feedback", "edit",
	"figures", "directions", "routes", "look", "target", "notes", "delegated",
}

func (c Commands) Apply(ctx context.Context, id, actor string, input json.RawMessage) (contract.Run, error) {
	var fields map[string]json.RawMessage
	if json.Unmarshal(input, &fields) != nil {
		return contract.Run{}, ErrInvalidInput
	}
	var operation, kind string
	if json.Unmarshal(fields["operationId"], &operation) != nil ||
		json.Unmarshal(fields["type"], &kind) != nil ||
		strings.TrimSpace(operation) == "" || units(operation) > 100 || kind == "" {
		return contract.Run{}, ErrInvalidInput
	}

	run, err := c.Store.GetRun(ctx, id)
	if err != nil {
		return contract.Run{}, err
	}
	var journal struct {
		State struct {
			Version, Revision int64
			Status            string
		}
		Operations map[string]string
	}
	if err := json.Unmarshal(run.Value, &journal); err != nil {
		return contract.Run{}, err
	}
	body := make(map[string]json.RawMessage)
	for _, key := range commandSignatureFields {
		if value, exists := fields[key]; exists {
			body[key] = value
		}
	}
	signature, err := json.Marshal(body)
	if err != nil {
		return contract.Run{}, err
	}
	if previous, exists := journal.Operations[operation]; exists {
		var old map[string]json.RawMessage
		if json.Unmarshal([]byte(previous), &old) != nil {
			return contract.Run{}, contract.ErrConflict
		}
		normalized, marshalErr := json.Marshal(old)
		if marshalErr != nil || string(normalized) != string(signature) {
			return contract.Run{}, contract.ErrConflict
		}
		return run, nil
	}
	var expected int64
	if json.Unmarshal(fields["expectedVersion"], &expected) != nil || expected < 1 ||
		expected != journal.State.Version {
		return contract.Run{}, contract.ErrConflict
	}
	// 사용자가 맡긴 요청 표시는 에이전트가 보낸 경우에만 의미가 있다 · ADR-0006
	delegated := actor == "agent" && string(fields["delegated"]) == "true"
	if err := writing.CheckCommand(run, kind, actor, delegated); err != nil {
		return contract.Run{}, err
	}
	if kind == "pause" {
		pauser, ok := c.Scheduler.(interface {
			PauseCommand(context.Context, string, int64, runner.PauseRecord) error
		})
		if !ok {
			return contract.Run{}, contract.ErrDeliveryUncertain
		}
		err := pauser.PauseCommand(ctx, id, run.Version, func(next contract.Run) (contract.Run, error) {
			value, err := recordCommand(next.Value, operation, string(signature), kind, actor, delegated, contract.Action{})
			next.Value = value
			return next, err
		})
		if err != nil {
			return contract.Run{}, err
		}
		return c.Store.GetRun(ctx, id)
	}
	body["reviewedRevision"], _ = json.Marshal(journal.State.Revision)
	if kind == "feedback" && actor == "agent" {
		body["briefPreapproved"] = json.RawMessage("true")
	}
	if kind == "revise_brief" {
		body["note"] = body["feedback"]
		if body["note"] == nil {
			delete(body, "note")
		}
	}
	eventKind := kind
	if kind == "resume" && journal.State.Status == "failed" {
		eventKind = "retry"
	}
	delete(body, "type")
	delete(body, "delegated")
	eventBody, err := json.Marshal(body)
	if err != nil {
		return contract.Run{}, err
	}
	next, err := c.Rules.Reduce(run, contract.Event{ID: operation, Actor: "user", Kind: eventKind, Body: eventBody})
	if err != nil {
		return contract.Run{}, err
	}
	action, nextErr := c.Rules.Next(next)
	if nextErr != nil {
		return contract.Run{}, nextErr
	}
	next.Value, err = recordCommand(next.Value, operation, string(signature), kind, actor, delegated, action)
	if err != nil {
		return contract.Run{}, err
	}
	if err := c.Store.UpdateRun(ctx, run.Version, next); err != nil {
		return contract.Run{}, err
	}
	if action.Kind != "" {
		c.Scheduler.Wake(id)
	}
	return next, nil
}

func recordCommand(value json.RawMessage, operation, signature, kind, actor string, delegated bool, action contract.Action) (json.RawMessage, error) {
	var record map[string]json.RawMessage
	if err := json.Unmarshal(value, &record); err != nil {
		return nil, err
	}
	operations := make(map[string]string)
	if raw, ok := record["operations"]; ok {
		if err := json.Unmarshal(raw, &operations); err != nil {
			return nil, err
		}
	}
	if operations == nil {
		operations = make(map[string]string)
	}
	operations[operation] = signature
	record["operations"], _ = json.Marshal(operations)

	var state struct {
		Revision int64
		Stage    string
	}
	if err := json.Unmarshal(record["state"], &state); err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	if err := appendActivity(record, activityEvent{
		At: now, Revision: state.Revision, Stage: state.Stage,
		By: actor, Delegated: delegated, Kind: kind, Label: commandLabel(kind),
	}); err != nil {
		return nil, err
	}
	if action.Kind != "" {
		var limit int
		switch {
		case action.Kind == "request_figure":
			limit = 1
		case kind == "complete_requirements":
			limit = initialCalls
		case kind == "feedback" || kind == "resume":
			limit = followupCalls
		}
		if limit > 0 {
			record["callsUsed"] = json.RawMessage("0")
			record["maxCalls"], _ = json.Marshal(limit)
			record["startedAt"], _ = json.Marshal(now)
		}
	}

	return json.Marshal(record)
}

func commandLabel(kind string) string {
	switch kind {
	case "feedback":
		return "수정 요청"
	case "approve_brief":
		return "수정 해석 승인"
	case "revise_brief":
		return "수정 해석 다시 요청"
	case "satisfy":
		return "초안 확정"
	case "authorize_publication":
		return "발행 준비 승인"
	case "pause":
		return "작업 중단"
	case "resume":
		return "작업 다시 연결"
	case "complete_requirements":
		return "요구사항 보완"
	default:
		return "시각자료 변경"
	}
}
