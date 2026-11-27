package editorial

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

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
		State      struct{ Version int64 }
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
	next, err := c.Rules.Reduce(run, contract.Event{ID: operation, Actor: "user", Kind: kind, Body: signature})
	if err != nil {
		return contract.Run{}, err
	}
	next.Value, err = recordCommand(next.Value, operation, string(signature), kind, actor)
	if err != nil {
		return contract.Run{}, err
	}
	if err := c.Store.UpdateRun(ctx, run.Version, next); err != nil {
		return contract.Run{}, err
	}
	if action, err := c.Rules.Next(next); err == nil && action.Kind != "" && action.Kind != "requirements_required" {
		c.Scheduler.Wake(id)
	}
	return next, nil
}

func recordCommand(value json.RawMessage, operation, signature, kind, actor string) (json.RawMessage, error) {
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
	return json.Marshal(record)
}
