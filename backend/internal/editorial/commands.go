package editorial

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/writing"
)

type Commands struct {
	Store     contract.Store
	Rules     contract.EditorialRules
	Scheduler contract.Scheduler
}

var commandSignatureFields = []string{
	"figure", "quote", "claim", "expectedVersion", "type", "feedback", "edit",
	"figures", "directions", "routes", "look", "target",
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
		State      struct{ Version, Revision int64 }
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
	if err := writing.CheckCommand(run, kind, actor); err != nil {
		return contract.Run{}, err
	}
	if kind == "pause" {
		return contract.Run{}, errors.New("pause requires remote confirmation")
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
	eventBody, err := json.Marshal(body)
	if err != nil {
		return contract.Run{}, err
	}
	next, err := c.Rules.Reduce(run, contract.Event{ID: operation, Actor: "user", Kind: kind, Body: eventBody})
	if err != nil {
		return contract.Run{}, err
	}
	action, nextErr := c.Rules.Next(next)
	if nextErr != nil {
		return contract.Run{}, nextErr
	}
	next.Value, err = recordCommand(next.Value, operation, string(signature), kind, actor, action)
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

func recordCommand(value json.RawMessage, operation, signature, kind, actor string, action contract.Action) (json.RawMessage, error) {
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

	var events []json.RawMessage
	if raw, ok := record["events"]; ok {
		if err := json.Unmarshal(raw, &events); err != nil {
			return nil, err
		}
	}
	event, _ := json.Marshal(map[string]string{"kind": kind, "by": actor})
	record["events"], _ = json.Marshal(append(events, event))
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
			record["startedAt"], _ = json.Marshal(time.Now().UnixMilli())
		}
	}

	return json.Marshal(record)
}
