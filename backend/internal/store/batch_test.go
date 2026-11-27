package store

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

func TestMIG012BatchReservationAndGlobalCapacity(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "private", "writing.db")
	writer, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Close()
	reader, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	makeRun := func(id string) contract.Run {
		return contract.Run{ID: id, RequestID: id, Version: 1, Value: json.RawMessage(`{}`)}
	}
	batch, single := makeRun("batch"), makeRun("single")
	for _, run := range []contract.Run{batch, single} {
		if err := writer.CreateRun(ctx, run); err != nil {
			t.Fatal(err)
		}
	}
	batch.Version++
	single.Version++
	parent := contract.Intent{ID: "parent", RunID: batch.ID, Action: json.RawMessage(`{}`)}
	first := contract.Intent{ID: "one", RunID: batch.ID, AgentID: "remote-one", Action: json.RawMessage(`{}`)}
	second := contract.Intent{ID: "two", RunID: batch.ID, AgentID: "remote-two", Action: json.RawMessage(`{}`)}
	if err := writer.ReserveBatch(ctx, 1, batch, parent, []contract.Intent{first, first}); !errors.Is(err, contract.ErrConflict) {
		t.Fatalf("duplicate batch unexpectedly reserved: %v", err)
	}
	current, err := reader.GetRun(ctx, batch.ID)
	if err != nil || current.Version != 1 {
		t.Fatalf("part failure did not roll back the parent: %v", err)
	}
	if err := writer.ReserveBatch(ctx, 1, batch, parent, []contract.Intent{first, second}); err != nil {
		t.Fatal(err)
	}
	singleTurn := contract.Intent{ID: "standalone", RunID: single.ID, AgentID: "remote-single", Action: json.RawMessage(`{}`)}
	if ok, err := reader.ReserveWithinLimit(ctx, 1, single, singleTurn, 2); !ok || err != nil {
		t.Fatalf("batch parent occupied a remote execution slot: %v", err)
	}
	if ok, err := writer.ClaimBatchChild(ctx, first.ID, 2); !ok || err != nil {
		t.Fatalf("first child was not claimed: %v", err)
	}
	if ok, err := reader.ClaimBatchChild(ctx, second.ID, 2); ok || err != nil {
		t.Fatalf("child exceeded the shared execution limit: %v", err)
	}
	if err := reader.Bind(ctx, first.ID, contract.RemoteRef{AgentID: first.AgentID, TurnID: "one-turn"}); err != nil {
		t.Fatal(err)
	}
	observed, err := reader.BatchChildren(ctx, parent.ID)
	if err != nil || len(observed) != 2 || !observed[0].Started || observed[1].Started || observed[0].Remote.TurnID != "one-turn" {
		t.Fatalf("durable child state lost: %+v / %v", observed, err)
	}
	batch.Version++
	if err := writer.Commit(ctx, 2, parent.ID, batch); !errors.Is(err, contract.ErrConflict) {
		t.Fatalf("batch committed while children were missing: %v", err)
	}
	result := contract.Event{ID: first.ID, Actor: "adapter", Kind: "figure_result", Body: json.RawMessage(`{}`)}
	if err := reader.FinishBatchChild(ctx, first.ID, true, &result, ""); err != nil {
		t.Fatal(err)
	}
	if ok, err := writer.ClaimBatchChild(ctx, second.ID, 2); !ok || err != nil {
		t.Fatalf("terminal child did not release the execution slot: %v", err)
	}
	if err := reader.FinishBatchChild(ctx, second.ID, true, nil, "known failure"); err != nil {
		t.Fatal(err)
	}
	observed, err = reader.BatchChildren(ctx, parent.ID)
	if err != nil || observed[0].Result == nil || observed[1].Failure != "known failure" {
		t.Fatalf("child terminal result was not durable: %+v / %v", observed, err)
	}
	if err := writer.Commit(ctx, 2, parent.ID, batch); err != nil {
		t.Fatal(err)
	}
	if got, err := reader.BatchChildren(ctx, parent.ID); err != nil || len(got) != 0 {
		t.Fatalf("completed children still active: %+v / %v", got, err)
	}
}
