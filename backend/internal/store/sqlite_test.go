package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

func TestAINAPI001AtomicReservationAndCompletion(t *testing.T) {
	ctx := t.Context()
	path := filepath.Join(privateTestDir(t), "editorial.sqlite")
	first := openTestStore(t, path)
	second := openTestStore(t, path)
	initial := budgetRun(1, 0)
	if err := first.CreateRun(ctx, initial); err != nil {
		t.Fatal(err)
	}
	duplicate := initial
	duplicate.ID = "duplicate"
	requireError(t, first.CreateRun(ctx, duplicate), contract.ErrConflict)

	deadline := time.Date(2026, 11, 27, 18, 0, 0, 0, time.UTC)
	winner := compete(t, func(i int) error {
		stores := []*SQLite{first, second}
		return stores[i].Reserve(ctx, 1, budgetRun(2, 1), contract.Intent{
			ID: fmt.Sprintf("job-%d", i), RunID: initial.ID, AgentID: "local",
			Action: json.RawMessage(`{"type":"draft"}`), Deadline: deadline,
		})
	})
	id := fmt.Sprintf("job-%d", winner)
	requireError(t, first.Reserve(ctx, 2, budgetRun(3, 8), contract.Intent{
		ID: "other-job", RunID: initial.ID, Action: json.RawMessage(`{}`),
	}), contract.ErrConflict)
	requireError(t, first.Commit(ctx, 1, id, budgetRun(2, 8)), contract.ErrConflict)
	assertRun(t, first, budgetRun(2, 1))

	bound := contract.RemoteRef{AgentID: "remote", TurnID: "turn", Epoch: "epoch", After: 42}
	if err := first.Bind(ctx, id, bound); err != nil {
		t.Fatal(err)
	}
	if err := second.Bind(ctx, id, contract.RemoteRef{AgentID: bound.AgentID, After: 10}); err != nil {
		t.Fatal(err)
	}
	requireError(t, first.Bind(ctx, id, contract.RemoteRef{AgentID: "replacement"}), contract.ErrConflict)
	for _, store := range []*SQLite{first, second} {
		if err := store.Close(); err != nil {
			t.Fatal(err)
		}
	}

	first = openTestStore(t, path)
	second = openTestStore(t, path)
	var pending []contract.Intent
	if err := first.ScanPending(ctx, func(intent contract.Intent) error {
		pending = append(pending, intent)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if len(pending) != 1 || pending[0].ID != id || pending[0].RunID != initial.ID ||
		pending[0].AgentID != "local" || pending[0].Remote != bound ||
		!pending[0].Deadline.Equal(deadline) || string(pending[0].Action) != `{"type":"draft"}` {
		t.Fatal("reserved job did not survive reopening")
	}

	compete(t, func(i int) error {
		stores := []*SQLite{first, second}
		return stores[i].Commit(ctx, 2, id, budgetRun(3, 1))
	})
	requireError(t, first.Commit(ctx, 3, id, budgetRun(4, 8)), contract.ErrConflict)
	requireError(t, first.Reserve(ctx, 3, budgetRun(4, 8), contract.Intent{
		ID: id, RunID: initial.ID, Action: json.RawMessage(`{}`),
	}), contract.ErrConflict)
	assertRun(t, second, budgetRun(3, 1))

	if err := second.Reserve(ctx, 3, budgetRun(4, 2), contract.Intent{
		ID: "next", RunID: initial.ID, Action: json.RawMessage(`{}`),
	}); err != nil {
		t.Fatal(err)
	}
}

func TestEDIT001OperationSignatureAndRunCAS(t *testing.T) {
	ctx := t.Context()
	store := openTestStore(t, filepath.Join(privateTestDir(t), "editorial.sqlite"))
	initial := contract.Run{ID: "run", RequestID: "req", Version: 1, Value: json.RawMessage(`{"operations":{"op":"one"}}`)}
	if err := store.CreateRun(ctx, initial); err != nil {
		t.Fatal(err)
	}
	proposed := initial
	proposed.Version++
	proposed.Value = json.RawMessage(`{"operations":{"op":"two"}}`)
	requireError(t, store.UpdateRun(ctx, 1, proposed), contract.ErrConflict)
	proposed.Value = json.RawMessage(`{}`)
	requireError(t, store.UpdateRun(ctx, 1, proposed), contract.ErrConflict)
	proposed.Value = json.RawMessage(`{"operations":{"op":"one","new":"two"}}`)
	if err := store.UpdateRun(ctx, 1, proposed); err != nil {
		t.Fatal(err)
	}
	assertRun(t, store, proposed)
	requireError(t, store.UpdateRun(ctx, 1, proposed), contract.ErrConflict)
	_, err := store.FindRequest(ctx, "absent")
	requireError(t, err, contract.ErrNotFound)
}

func TestAINAPI001PrivateDatabaseAndWritablePendingVisitor(t *testing.T) {
	ctx := t.Context()
	path := filepath.Join(t.TempDir(), "private", "editorial.sqlite")
	store := openTestStore(t, path)
	for name, want := range map[string]os.FileMode{path: 0o600, filepath.Dir(path): 0o700, path + "-wal": 0o600} {
		info, err := os.Stat(name)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != want {
			t.Fatalf("mode = %o, want %o", info.Mode().Perm(), want)
		}
	}
	var journalMode string
	if err := store.db.QueryRowContext(ctx, "PRAGMA journal_mode").Scan(&journalMode); err != nil || journalMode != "wal" {
		t.Fatalf("journal mode = %q, %v", journalMode, err)
	}
	const total = pageSize + 2
	for i := range total {
		run := contract.Run{ID: fmt.Sprint(i), RequestID: fmt.Sprint(i), Version: 1, Value: json.RawMessage(`{}`)}
		if err := store.CreateRun(ctx, run); err != nil {
			t.Fatal(err)
		}
		run.Version++
		if err := store.Reserve(ctx, 1, run, contract.Intent{
			ID: run.ID, RunID: run.ID, Action: json.RawMessage(`{}`),
		}); err != nil {
			t.Fatal(err)
		}
	}
	watched, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	count := 0
	if err := store.ScanPending(watched, func(intent contract.Intent) error {
		count++
		run, err := store.GetRun(watched, intent.RunID)
		if err != nil {
			return err
		}
		run.Version++
		return store.Commit(watched, 2, intent.ID, run)
	}); err != nil {
		t.Fatal(err)
	}
	if count != total {
		t.Fatalf("visited %d intents, want %d", count, total)
	}
}

func compete(t *testing.T, action func(int) error) int {
	t.Helper()
	ready, start := make(chan struct{}, 2), make(chan struct{})
	type result struct {
		index int
		err   error
	}
	results := make(chan result, 2)
	for i := range 2 {
		go func() {
			ready <- struct{}{}
			<-start
			results <- result{i, action(i)}
		}()
	}
	<-ready
	<-ready
	close(start)
	winner := -1
	for range 2 {
		item := <-results
		if item.err == nil && winner == -1 {
			winner = item.index
			continue
		}
		requireError(t, item.err, contract.ErrConflict)
	}
	if winner == -1 {
		t.Fatal("no write won the competition")
	}
	return winner
}

func budgetRun(version int64, calls int) contract.Run {
	return contract.Run{
		ID: "run", RequestID: "request", Version: version,
		Value: fmt.Appendf(nil, `{"callsUsed":%d}`, calls),
	}
}

func assertRun(t *testing.T, store *SQLite, want contract.Run) {
	t.Helper()
	got, err := store.FindRequest(t.Context(), want.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != want.ID || got.Version != want.Version || string(got.Value) != string(want.Value) {
		t.Fatalf("run metadata or payload changed unexpectedly, version = %d, want %d", got.Version, want.Version)
	}
}

func requireError(t *testing.T, err, want error) {
	t.Helper()
	if !errors.Is(err, want) {
		t.Fatalf("error = %v, want %v", err, want)
	}
}

func openTestStore(t *testing.T, path string, options ...Option) *SQLite {
	t.Helper()
	store, err := Open(t.Context(), path, options...)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	return store
}

func privateTestDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.Chmod(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestEDIT001LegacyNullOperations(t *testing.T) {
	ctx := t.Context()
	store := openTestStore(t, filepath.Join(privateTestDir(t), "editorial.sqlite"))
	run := contract.Run{ID: "legacy", RequestID: "legacy-req", Version: 1, Value: json.RawMessage(`{"operations":null}`)}
	if err := store.CreateRun(ctx, run); err != nil {
		t.Fatal(err)
	}
	run.Version++
	run.Value = json.RawMessage(`{"operations":{"new":"signature"}}`)
	if err := store.UpdateRun(ctx, 1, run); err != nil {
		t.Fatal(err)
	}
}
