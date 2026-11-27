package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/datalock"
	"github.com/pollux-o4/AIN/backend/internal/sessions"
	"github.com/pollux-o4/AIN/backend/internal/store"
)

func TestPrunePreservesWarmAndUnconfirmedSessions(t *testing.T) {
	ctx := t.Context()
	root := privateTestDir(t)
	db := newTestStore(t, root)
	registry, err := db.SessionRegistry(ctx)
	if err != nil {
		t.Fatal(err)
	}
	clock := time.Now()
	wire := &fixtureWire{body: map[string]json.RawMessage{}}
	manager, err := sessions.New(registry, wire, sessions.Config{Owner: root, Now: func() time.Time { return clock }})
	if err != nil {
		t.Fatal(err)
	}
	track := func(id, status string, owned, keep bool) {
		t.Helper()
		labels := manager.Labels(id)
		if !owned {
			labels["owner"] = "/another-project"
		}
		wire.body[id], err = json.Marshal(map[string]any{
			"agent":   map[string]any{"id": id, "provider": "antigravity", "labels": labels, "status": status, "activeTurn": nil},
			"entries": []any{map[string]any{"turnId": "native", "seqEnd": 2}},
		})
		if err != nil {
			t.Fatal(err)
		}
		lease, err := manager.TrackFresh(ctx, sessions.Key{ArticleID: id, Role: "planner"}, id, id, "msg", "antigravity")
		if err != nil {
			t.Fatal(err)
		}
		if keep {
			snapshot := contract.Snapshot{Ref: contract.RemoteRef{AgentID: id, Epoch: "fixture", TurnID: "msg", After: 2},
				Status: "completed", Body: json.RawMessage(`{"daemonTurnId":"native"}`)}
			if err := manager.Release(ctx, lease, snapshot, nil, true); err != nil {
				t.Fatal(err)
			}
		}
	}
	clock = clock.Add(-time.Hour)
	track("old", "idle", true, false)
	track("foreign", "idle", false, false)
	track("unknown", "connecting", true, false)
	track("unreachable", "idle", true, false)
	delete(wire.body, "unreachable")
	track("pending", "idle", true, false)
	track("batch-child", "idle", true, false)
	clock = clock.Add(time.Hour)
	track("warm", "idle", true, true)
	reserveTestWork(t, db, "pending", false)
	reserveTestWork(t, db, "batch-child", true)

	initial, err := prune(ctx, root, wire, false)
	if err != nil || initial.Archived != 1 || initial.Warm != 1 || initial.Deferred != 2 || initial.Foreign != 1 {
		t.Fatalf("initial sweep = %+v, %v", initial, err)
	}
	all, err := prune(ctx, root, wire, true)
	if err != nil || all.Archived != 1 || all.Warm != 0 || all.Deferred != 2 ||
		!slices.Equal(wire.archived, []string{"old", "warm"}) {
		t.Fatalf("all sweep = %+v, %v, archives = %v", all, err, wire.archived)
	}
}

func TestPruneRequiresAnExclusiveGoDataDirectory(t *testing.T) {
	ctx := t.Context()
	root := privateTestDir(t)
	wire := &fixtureWire{}
	if _, err := prune(ctx, root, wire, true); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing data = %v", err)
	}
	path := filepath.Join(root, "editorial.sqlite")
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("prune created a database: %v", err)
	}
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer legacy.Close()
	if _, err := legacy.ExecContext(ctx, "CREATE TABLE editorial_runs (id TEXT PRIMARY KEY)"); err != nil {
		t.Fatal(err)
	}
	if _, err := prune(ctx, root, wire, true); err == nil || !strings.Contains(err.Error(), "existing Go editorial schema") {
		t.Fatalf("legacy data = %v", err)
	}
	var migrated bool
	if err := legacy.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name = 'ain_schema_migrations')").Scan(&migrated); err != nil || migrated {
		t.Fatalf("legacy database was changed: %t, %v", migrated, err)
	}

	root = privateTestDir(t)
	newTestStore(t, root)
	lock, err := datalock.Acquire(root)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	for _, all := range []bool{false, true} {
		if _, err := prune(ctx, root, wire, all); err == nil || !strings.Contains(err.Error(), "another Go runtime") {
			t.Fatalf("prune with runtime lock held (all=%t) = %v", all, err)
		}
	}
	if wire.probes != 0 {
		t.Fatalf("Paseo was contacted before storage validation: %d", wire.probes)
	}
}

func privateTestDir(t *testing.T) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), "editorial")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	return root
}

func newTestStore(t *testing.T, root string) *store.SQLite {
	t.Helper()
	db, err := store.Open(t.Context(), filepath.Join(root, "editorial.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func reserveTestWork(t *testing.T, db *store.SQLite, agent string, batch bool) {
	t.Helper()
	ctx := t.Context()
	run := contract.Run{ID: agent, RequestID: agent, Version: 1, Value: json.RawMessage(`{}`)}
	if err := db.CreateRun(ctx, run); err != nil {
		t.Fatal(err)
	}
	run.Version++
	job := contract.Intent{ID: agent, RunID: run.ID, AgentID: agent, Action: json.RawMessage(`{}`)}
	if !batch {
		if err := db.Reserve(ctx, 1, run, job); err != nil {
			t.Fatal(err)
		}
		return
	}
	parent := contract.Intent{ID: "parent", RunID: run.ID, Action: json.RawMessage(`{}`)}
	if err := db.ReserveBatch(ctx, 1, run, parent, []contract.Intent{job}); err != nil {
		t.Fatal(err)
	}
	if claimed, err := db.ClaimBatchChild(ctx, job.ID, 8); err != nil || !claimed {
		t.Fatalf("claim batch child = %t, %v", claimed, err)
	}
}

type fixtureWire struct {
	sessions.Wire
	body     map[string]json.RawMessage
	archived []string
	probes   int
}

func (w *fixtureWire) Probe(context.Context) (json.RawMessage, error) {
	w.probes++
	return nil, nil
}

func (w *fixtureWire) Snapshot(_ context.Context, ref contract.RemoteRef) (contract.Snapshot, error) {
	body, ok := w.body[ref.AgentID]
	if !ok {
		return contract.Snapshot{}, fmt.Errorf("unconfirmed remote state")
	}
	ref.Epoch, ref.After = "fixture", 2
	return contract.Snapshot{Ref: ref, Body: body}, nil
}

func (w *fixtureWire) Archive(_ context.Context, ref contract.RemoteRef) error {
	w.archived = append(w.archived, ref.AgentID)
	return nil
}
