package editorial

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/store"
	"github.com/pollux-o4/AIN/backend/internal/writing"
)

func TestEDIT001SeparatePublicationApproval(t *testing.T) {
	ctx := t.Context()
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "private", "editorial.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	fixture, err := os.ReadFile("../../../tests/migration/reference/flow-001.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct{ State json.RawMessage }
	if err := json.Unmarshal(fixture, &cases); err != nil || len(cases) == 0 {
		t.Fatalf("invalid fixture: %v", err)
	}
	state := cases[len(cases)-1].State
	version := readVersion(t, state)
	run := contract.Run{ID: "reviewed", RequestID: "reviewed-request", Version: version, Value: json.RawMessage(fmt.Sprintf(`{"state":%s}`, state))}
	if err := db.CreateRun(ctx, run); err != nil {
		t.Fatal(err)
	}
	commands := Commands{Store: db, Rules: writing.New(), Scheduler: make(wakeRecorder, 1)}
	satisfy := json.RawMessage(fmt.Sprintf(`{"type":"satisfy","operationId":"satisfy","expectedVersion":%d}`, version))
	if _, err := commands.Apply(ctx, run.ID, "agent", satisfy); !errors.Is(err, writing.ErrHumanApproval) {
		t.Fatalf("agent approval: %v", err)
	}
	satisfied, err := commands.Apply(ctx, run.ID, "user", satisfy)
	if err != nil {
		t.Fatal(err)
	}
	assertCommandState(t, satisfied.Value, "satisfied")
	retry, err := commands.Apply(ctx, run.ID, "user", satisfy)
	if err != nil || retry.Version != satisfied.Version {
		t.Fatalf("approval replay changed version: %v", err)
	}
	authorize := json.RawMessage(fmt.Sprintf(`{"type":"authorize_publication","operationId":"authorize","expectedVersion":%d}`, version+1))
	approved, err := commands.Apply(ctx, run.ID, "user", authorize)
	if err != nil {
		t.Fatal(err)
	}
	assertCommandState(t, approved.Value, "publication_ready")
}

func readVersion(t *testing.T, data json.RawMessage) int64 {
	t.Helper()
	var state struct{ Version int64 }
	if err := json.Unmarshal(data, &state); err != nil || state.Version == 0 {
		t.Fatalf("invalid state version: %v", err)
	}
	return state.Version
}

func assertCommandState(t *testing.T, value json.RawMessage, want string) {
	t.Helper()
	var record struct{ State struct{ Status string } }
	if err := json.Unmarshal(value, &record); err != nil || record.State.Status != want {
		t.Fatalf("status=%q, want %q (%v)", record.State.Status, want, err)
	}
}
