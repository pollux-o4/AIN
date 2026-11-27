package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

type pilotFixture struct {
	wire
	id                    string
	response              string
	created, archiveCalls int
}

func (f *pilotFixture) Create(_ context.Context, id string, spec contract.SessionSpec) (contract.RemoteRef, error) {
	f.id = id
	f.created++
	f.response = spec.Prompt[strings.LastIndex(spec.Prompt, "{"):]
	return contract.RemoteRef{}, contract.ErrDeliveryUncertain
}

func (f *pilotFixture) Snapshot(_ context.Context, ref contract.RemoteRef) (contract.Snapshot, error) {
	if ref.AgentID != f.id {
		return contract.Snapshot{}, contract.ErrNotFound
	}
	if ref.TurnID == "" {
		result := contract.Snapshot{Ref: ref, Body: json.RawMessage(`{"agent":{}}`)}
		if f.archiveCalls > 0 {
			result.Body = json.RawMessage(`{"agent":{"archivedAt":"2026-01-01T00:00:00Z"}}`)
		}
		return result, nil
	}
	if ref.TurnID != f.id {
		return contract.Snapshot{}, contract.ErrNotFound
	}
	raw, _ := json.Marshal(map[string]string{"daemonTurnId": "fixture-turn", "text": f.response})
	return contract.Snapshot{Ref: ref, Status: "completed", Body: raw}, nil
}

func (f *pilotFixture) Archive(_ context.Context, ref contract.RemoteRef) error {
	if ref.AgentID != f.id || ref.TurnID != f.id {
		return contract.ErrDeliveryUncertain
	}
	f.archiveCalls++
	return nil
}

func TestPilotReconcilesLostAckWithoutReplay(t *testing.T) {
	client := &pilotFixture{}
	report := &probeReport{}
	if err := pilot(context.Background(), client, config{Root: t.TempDir()}, "", report); err != nil {
		t.Fatal(err)
	}
	if client.created != 1 || report.PilotCalls != 1 || client.archiveCalls != 1 || len(report.CleanupIssues) != 0 {
		t.Fatalf("unexpected pilot outcome: %+v, %+v", client, report)
	}
}
