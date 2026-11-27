package runner

import (
	"encoding/json"
	"testing"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

func TestCompletionCorroboratesWatcherUsage(t *testing.T) {
	turn := contract.Snapshot{
		Ref:    contract.RemoteRef{AgentID: "a", TurnID: "message", Epoch: "epoch", After: 5},
		Status: "completed", Body: json.RawMessage(`{"daemonTurnId":"native"}`),
	}
	watched := turn
	watched.Usage = &contract.TurnUsage{InputTokens: 1, OutputTokens: 2}
	if usage := corroboratedUsage(turn, &watched); usage == nil || *usage != *watched.Usage {
		t.Fatal("same terminal turn did not carry exact watcher usage")
	}
	for _, mutate := range []func(*contract.Snapshot){
		func(s *contract.Snapshot) { s.Ref.AgentID = "other agent" },
		func(s *contract.Snapshot) { s.Ref.TurnID = "other client message" },
		func(s *contract.Snapshot) { s.Ref.Epoch = "replaced" },
		func(s *contract.Snapshot) { s.Ref.After = 9 },
		func(s *contract.Snapshot) { s.Body = json.RawMessage(`{"daemonTurnId":"old native turn"}`) },
	} {
		other := watched
		mutate(&other)
		if corroboratedUsage(turn, &other) != nil {
			t.Fatal("usage crossed an unverified execution boundary")
		}
	}
}

func TestBatchUsageDoesNotReportPartialCounts(t *testing.T) {
	known := &contract.Event{Usage: &contract.TurnUsage{InputTokens: 10, OutputTokens: 2}}
	children := []contract.BatchChild{{Result: known}, {Result: known}}
	if usage := completeBatchUsage(children); usage == nil || usage.InputTokens != 20 || usage.OutputTokens != 4 {
		t.Fatal("complete usage did not sum both child results")
	}
	children[1].Result = nil
	if completeBatchUsage(children) != nil {
		t.Fatal("verified child usage was presented as a batch total")
	}
}
