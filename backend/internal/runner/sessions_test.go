package runner

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/sessions"
)

func TestMIG014RunnerLeasesAndRecoversExactManagedTurn(t *testing.T) {
	ctx := t.Context()
	store := newTestStore("article")
	wire := &managedWire{t: t, store: store}
	manager, registry := runnerSessionManager(t, wire)
	r := managedRunner(t, store, wire, manager)

	first, _ := store.GetRun(ctx, "article")
	advanced, err := r.start(ctx, first)
	if err != nil || !advanced || wire.creates != 1 || wire.sends != 0 {
		t.Fatalf("fresh turn: advanced=%v create=%d send=%d err=%v", advanced, wire.creates, wire.sends, err)
	}
	workers, err := registry.List(ctx)
	if err != nil || len(workers) != 1 || string(workers[0].Phase) != "warm" || workers[0].Delivered["idea"] != "initial" {
		t.Fatalf("confirmed first result did not publish its role for reuse: %v", err)
	}
	second := receive(t, store.committed)
	advanced, err = r.start(ctx, second)
	if advanced || !errors.Is(err, contract.ErrDeliveryUncertain) || wire.creates != 1 || wire.sends != 1 || store.commitCount.Load() != 1 {
		t.Fatalf("stale previous native turn was applied or ambiguous send replayed: %v", err)
	}
	intent, err := store.currentIntent("article")
	if err != nil {
		t.Fatal(err)
	}
	if intent.AgentID != wire.agent || intent.Remote.Epoch != "epoch" {
		t.Fatal("remote assignment was not persisted")
	}
	r.sweep(ctx, true)
	if wire.archives != 0 {
		t.Fatal("shutdown sweep archived a pending reused agent")
	}

	wire.native, wire.sequence = "native-2", 30
	// A new runner observes the durable intent and the already submitted turn.
	r = managedRunner(t, store, wire, manager)
	advanced, err = r.process(ctx, "article", &intent, false)
	if err != nil || !advanced || wire.creates != 1 || wire.sends != 1 || store.commitCount.Load() != 2 {
		t.Fatalf("recovery did not settle the original attempt: %v", err)
	}
	receive(t, store.committed)
	r.sweep(ctx, true)
	if wire.archives != 1 {
		t.Fatal("shutdown did not archive its now quiescent owned agent")
	}
}

func managedRunner(t *testing.T, store *testStore, wire *managedWire, manager *sessions.Manager) *Runner {
	t.Helper()
	clock := time.Date(2026, 11, 27, 0, 0, 0, 0, time.UTC)
	cfg := Config{
		Workers: 1, Queue: 1, TurnLimit: time.Minute, RecheckInterval: time.Second, MaxRechecks: 2,
		Now: func() time.Time { return clock }, Sessions: manager,
		Reserve: func(run contract.Run, _ contract.Action) (contract.Run, error) {
			run.Version++
			return run, nil
		},
		Paused: func(run contract.Run, _ *contract.Event) (contract.Run, error) { return run, nil },
	}
	r, err := New(store, wire, managedRules{}, managedTurns{}, cfg)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func runnerSessionManager(t *testing.T, wire sessions.Wire) (*sessions.Manager, *sessions.Registry) {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "synthetic.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	registry, err := sessions.NewRegistry(t.Context(), db)
	if err != nil {
		t.Fatal(err)
	}
	manager, err := sessions.New(registry, wire, sessions.Config{Owner: "/synthetic",
		Now: func() time.Time { return time.Date(2026, 11, 27, 0, 0, 0, 0, time.UTC) }})
	if err != nil {
		t.Fatal(err)
	}
	return manager, registry
}

type managedRules struct{}

func (managedRules) Next(run contract.Run) (contract.Action, error) {
	stage := "topic"
	if run.Version == 1 {
		stage = "diagnose"
	}
	return contract.Action{Kind: "request_ai", Stage: stage}, nil
}

func (managedRules) Reduce(run contract.Run, _ contract.Event) (contract.Run, error) {
	run.Version++
	return run, nil
}

type managedTurns struct{ testTurns }

func (managedTurns) SessionRole(contract.Action) (string, bool) { return "planner", true }

func (managedTurns) BuildTrackedTurn(contract.Run, contract.Action) (contract.SessionSpec, map[string]string, error) {
	return contract.SessionSpec{Provider: "antigravity", Model: "model", WorkDir: "/synthetic", Prompt: "initial"},
		map[string]string{"idea": "initial"}, nil
}

func (managedTurns) BuildReuseTurn(_ contract.Run, _ contract.Action, delivered map[string]string) (contract.SessionSpec, map[string]string, error) {
	if delivered["idea"] != "initial" {
		return contract.SessionSpec{}, nil, errors.New("previous fingerprints missing")
	}
	return contract.SessionSpec{Provider: "antigravity", Model: "model", WorkDir: "/synthetic", Prompt: "delta"},
		map[string]string{"idea": "updated"}, nil
}

type managedWire struct {
	contract.Paseo
	t     *testing.T
	store *testStore

	agent, message, native   string
	sequence                 int64
	labels                   map[string]string
	creates, sends, archives int
}

func (w *managedWire) Create(_ context.Context, agent string, spec contract.SessionSpec) (contract.RemoteRef, error) {
	w.creates++
	intent, err := w.store.currentIntent("article")
	if err != nil || intent.AgentID != agent || spec.Labels["source"] != sessions.Source ||
		spec.Labels["owner"] != "/synthetic" || spec.Labels["job"] != intent.ID {
		w.t.Fatal("agent was created before its labelled durable reservation")
	}
	w.agent, w.message, w.native, w.sequence, w.labels = agent, agent, "native-1", 10, spec.Labels
	return contract.RemoteRef{AgentID: agent, TurnID: agent}, nil
}

func (w *managedWire) Send(_ context.Context, ref contract.RemoteRef, prompt string) error {
	w.sends++
	intent, err := w.store.currentIntent("article")
	planned, decodeErr := decodeAction(intent)
	if err != nil || decodeErr != nil || planned.Session == nil || planned.Session.Reuse == nil ||
		intent.Remote.AgentID != w.agent || intent.Remote.After != 10 || intent.Remote.Epoch != "epoch" ||
		planned.Session.Reuse.Boundary.DaemonTurnID != "native-1" || planned.MessageID != ref.TurnID || prompt != "delta" {
		w.t.Fatal("reused delivery began without a durable identity and old-turn boundary")
	}
	w.message = ref.TurnID
	w.sequence = 20
	return contract.ErrDeliveryUncertain
}

func (w *managedWire) Snapshot(_ context.Context, ref contract.RemoteRef) (contract.Snapshot, error) {
	if ref.AgentID != w.agent {
		return contract.Snapshot{}, contract.ErrNotFound
	}
	observed := contract.RemoteRef{AgentID: w.agent, Epoch: "epoch", After: w.sequence}
	if ref.TurnID == "" {
		payload, _ := json.Marshal(map[string]any{
			"agent": map[string]any{
				"id": w.agent, "provider": "antigravity", "model": "model", "status": "idle", "labels": w.labels, "activeTurn": nil,
			},
			"entries": []map[string]any{{"turnId": w.native, "seqEnd": w.sequence}},
		})
		return contract.Snapshot{Ref: observed, Status: "idle", Body: payload}, nil
	}
	if ref.TurnID != w.message {
		return contract.Snapshot{}, contract.ErrDeliveryUncertain
	}
	observed.TurnID = w.message
	body, _ := json.Marshal(map[string]string{"daemonTurnId": w.native, "text": "synthetic"})
	return contract.Snapshot{Ref: observed, Status: "completed", Body: body}, nil
}

func (*managedWire) SetModel(context.Context, contract.RemoteRef, string) error {
	return errors.New("unexpected model change")
}

func (*managedWire) SetThinking(context.Context, contract.RemoteRef, string) error {
	return errors.New("unexpected thinking change")
}

func (w *managedWire) Archive(context.Context, contract.RemoteRef) error {
	w.archives++
	return nil
}
