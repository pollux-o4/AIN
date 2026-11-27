package writing

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

func TestFLOW001(t *testing.T) {
	data, err := os.ReadFile("../../../tests/migration/reference/flow-001.json")
	if err != nil {
		t.Fatal(err)
	}
	var steps []struct {
		Name   string
		Before json.RawMessage
		Event  json.RawMessage
		State  json.RawMessage
		Next   json.RawMessage
		Error  string
	}
	if err := json.Unmarshal(data, &steps); err != nil {
		t.Fatal(err)
	}
	rules := New()
	for _, step := range steps {
		t.Run(step.Name, func(t *testing.T) {
			record, err := json.Marshal(map[string]json.RawMessage{"state": step.Before, "extension": json.RawMessage(`"preserved"`)})
			if err != nil {
				t.Fatal(err)
			}
			run := contract.Run{Value: record}
			next, err := rules.Reduce(run, contract.Event{Body: step.Event})
			if step.Error != "" {
				if err == nil || err.Error() != step.Error || string(next.Value) != string(run.Value) {
					t.Fatalf("expected %q and preserved record, got %v", step.Error, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			var outer map[string]json.RawMessage
			if err := json.Unmarshal(next.Value, &outer); err != nil {
				t.Fatal(err)
			}
			equalJSON(t, outer["state"], step.State)
			equalJSON(t, outer["extension"], json.RawMessage(`"preserved"`))
			action, err := rules.Next(next)
			if err != nil {
				t.Fatal(err)
			}
			equalJSON(t, action.Input, step.Next)
		})
	}
}

func equalJSON(t *testing.T, actual, expected json.RawMessage) {
	t.Helper()
	var left, right any
	if json.Unmarshal(actual, &left) != nil || json.Unmarshal(expected, &right) != nil || !reflect.DeepEqual(left, right) {
		t.Fatalf("expected %s, got %s", expected, actual)
	}
}
