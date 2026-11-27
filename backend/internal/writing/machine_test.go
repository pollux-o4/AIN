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

func TestEDIT001FeedbackAndMarkedRevision(t *testing.T) {
	data, err := os.ReadFile("../../../tests/migration/reference/flow-001.json")
	if err != nil {
		t.Fatal(err)
	}
	var steps []struct{ State json.RawMessage }
	if json.Unmarshal(data, &steps) != nil {
		t.Fatal("invalid reference")
	}
	raw, err := json.Marshal(map[string]json.RawMessage{"state": steps[len(steps)-1].State})
	if err != nil {
		t.Fatal(err)
	}
	run := contract.Run{ID: "writing", RequestID: "start", Version: 100, Value: raw}
	rules := New()
	run = mustReduce(t, rules, run, contract.Event{ID: "satisfy", Actor: "user", Kind: "satisfy",
		Body: json.RawMessage(`{"expectedVersion":9,"reviewedRevision":1}`)})
	run = mustReduce(t, rules, run, contract.Event{ID: "publish", Actor: "user", Kind: "authorize_publication",
		Body: json.RawMessage(`{"expectedVersion":10,"reviewedRevision":1}`)})
	run = mustReduce(t, rules, run, contract.Event{ID: "feedback", Actor: "user", Kind: "feedback",
		Body: json.RawMessage(`{"expectedVersion":11,"reviewedRevision":1,"feedback":"本文を改善する"}`)})
	run = mustReduce(t, rules, run, contract.Event{ID: "route", Actor: "adapter", Kind: "route",
		Body: json.RawMessage(`{"expectedVersion":12,"revision":2,"target":"outline","reason":"言い換え","brief":{"level":"line"}}`)})
	_, state, err := decodeRecord(run)
	if err != nil || state["status"] != "awaiting_brief" || state["approval"] != nil || run.Version != 104 {
		t.Fatalf("feedback bypassed approval or desynchronized storage: %v", err)
	}
	run = mustReduce(t, rules, run, contract.Event{ID: "approve", Actor: "user", Kind: "approve_brief",
		Body: json.RawMessage(`{"expectedVersion":13,"reviewedRevision":2}`)})
	action, err := rules.Next(run)
	if err != nil {
		t.Fatal(err)
	}
	equalJSON(t, action.Input, json.RawMessage(`{"type":"request_ai","stage":"draft","revision":2,"feedback":"本文を改善する","mode":"edit"}`))
	run = mustReduce(t, rules, run, contract.Event{ID: "marked", Actor: "adapter", Kind: "complete",
		Body: json.RawMessage(`{"expectedVersion":14,"revision":2,"stage":"draft","mode":"edit","output":{"edits":[{"find":"実体験","replace":"現場経験"}],"changeSummary":"表現変更"}}`)})
	_, state, err = decodeRecord(run)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := baseline(state)
	after := obj(obj(obj(state["artifacts"])["draft"])["output"])["text"]
	if before != "# 体験\n\n実体験の本文。" || after != "# 体験\n\n現場経験の本文。" || state["stage"] != "review" {
		t.Fatalf("marked revision did not preserve prior baseline")
	}
}

func mustReduce(t *testing.T, rules *Rules, run contract.Run, event contract.Event) contract.Run {
	t.Helper()
	next, err := rules.Reduce(run, event)
	if err != nil {
		t.Fatal(err)
	}
	return next
}
