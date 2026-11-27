package runner

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/figuredomain"
	"github.com/pollux-o4/AIN/backend/internal/store"
)

func TestMIG012BatchRecoversStoredAndAmbiguousChildren(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "private", "writing.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	run, action, parent, children, parts := reserveFixtureBatch(t, ctx, db)
	deadline := parent.Deadline
	for _, child := range children[:2] {
		if ok, err := db.ClaimBatchChild(ctx, child.ID, 2); !ok || err != nil {
			t.Fatalf("cannot prepare recovery fixture: %v", err)
		}
	}
	done, err := testBatchTurns{}.ValidateResult(parts[0], contract.Snapshot{Status: "completed"})
	if err != nil {
		t.Fatal(err)
	}
	done.ID = children[0].ID
	if err := db.FinishBatchChild(ctx, done.ID, true, &done, ""); err != nil {
		t.Fatal(err)
	}

	// First recovery can find a saved outcome and a queued child, but the
	// previously claimed remote identity has no conclusive evidence yet.
	transport := &batchTransport{
		known:   map[string]bool{},
		allowed: children[2].AgentID,
	}
	r := fixtureBatchRunner(t, db, transport, action, deadline)
	advanced, err := r.process(ctx, run.ID, &parent, false)
	if advanced || !errors.Is(err, contract.ErrDeliveryUncertain) || transport.creates != 1 {
		t.Fatalf("ambiguous child was re-created or prematurely accepted: advanced=%t, creates=%d, err=%v", advanced, transport.creates, err)
	}
	kept, err := db.BatchChildren(ctx, parent.ID)
	if err != nil || len(kept) != 3 || kept[0].Result == nil || kept[2].Result == nil || !kept[1].Started {
		t.Fatalf("terminal peers were not kept for the next recovery: %v", err)
	}

	// After evidence arrives, recovery reads the exact remote child and
	// applies one parent result without creating any previously claimed child.
	transport.known[children[1].AgentID] = true
	r = fixtureBatchRunner(t, db, transport, action, deadline)
	advanced, err = r.process(ctx, run.ID, &parent, false)
	if err != nil || !advanced || transport.creates != 1 {
		t.Fatalf("recovery did not commit the entire batch: advanced=%t, creates=%d, err=%v", advanced, transport.creates, err)
	}
	current, err := db.GetRun(ctx, run.ID)
	if err != nil || current.Version != 3 || !strings.Contains(string(current.Value), `"f3"`) {
		t.Fatalf("parent action did not reflect the complete batch: %v", err)
	}
}

type batchTransport struct {
	contract.Paseo
	known   map[string]bool
	allowed string
	creates int
}

func (p *batchTransport) Create(_ context.Context, id string, _ contract.SessionSpec) (contract.RemoteRef, error) {
	p.creates++
	if id != p.allowed {
		return contract.RemoteRef{}, errors.New("unexpected create")
	}
	return contract.RemoteRef{AgentID: id, TurnID: id}, nil
}

func (p *batchTransport) Snapshot(_ context.Context, ref contract.RemoteRef) (contract.Snapshot, error) {
	if ref.AgentID == p.allowed || p.known[ref.AgentID] {
		return contract.Snapshot{Ref: contract.RemoteRef{AgentID: ref.AgentID, TurnID: ref.TurnID, Epoch: "fixture", After: 4}, Status: "completed"}, nil
	}
	return contract.Snapshot{}, contract.ErrNotFound
}

type testBatchTurns struct{}

func (testBatchTurns) BuildTurn(_ contract.Run, action contract.Action) (contract.SessionSpec, error) {
	if action.WorkID == "" || action.FigureID == "" {
		return contract.SessionSpec{}, errors.New("missing child work identity")
	}
	return contract.SessionSpec{Prompt: "synthetic figure"}, nil
}

func (testBatchTurns) ValidateResult(action contract.Action, _ contract.Snapshot) (contract.Event, error) {
	data, err := json.Marshal(map[string]any{
		"expectedVersion": action.StateVersion, "revision": 3, "stage": action.Stage, "figureId": action.FigureID, "pass": "draw",
		"output": map[string]any{"figures": []map[string]string{{"id": action.FigureID, "svg": "<svg></svg>"}}},
	})
	return contract.Event{Actor: "adapter", Kind: "figure_result", Body: data}, err
}

type testBatchRules struct{ action contract.Action }

func (r testBatchRules) Next(contract.Run) (contract.Action, error) { return r.action, nil }
func (testBatchRules) Reduce(run contract.Run, event contract.Event) (contract.Run, error) {
	run.Version++
	run.Value = event.Body
	return run, nil
}

func fixtureBatchRunner(t *testing.T, db *store.SQLite, transport contract.Paseo, action contract.Action, deadline time.Time) *Runner {
	t.Helper()
	r, err := New(db, transport, testBatchRules{action: action}, testBatchTurns{}, Config{
		Workers: 2, Queue: 2, TurnLimit: time.Hour, RecheckInterval: time.Second, MaxRechecks: 1,
		Now:     func() time.Time { return deadline.Add(-time.Hour) },
		Reserve: func(run contract.Run, _ contract.Action) (contract.Run, error) { run.Version++; return run, nil },
		Paused:  func(run contract.Run, _ *contract.Event) (contract.Run, error) { run.Version++; return run, nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func testBatchAction() contract.Action {
	input := json.RawMessage(`{"type":"request_figure","stage":"figure","revision":3,"pass":"draw",
		"figureIds":["f1","f2","f3"],"parts":[{"figureId":"f1"},{"figureId":"f2"},{"figureId":"f3"}]}`)
	return contract.Action{StateVersion: 7, Kind: "request_figure", Stage: "figure", Input: input}
}

func reserveFixtureBatch(t *testing.T, ctx context.Context, db *store.SQLite) (contract.Run, contract.Action, contract.Intent, []contract.Intent, []contract.Action) {
	t.Helper()
	action := testBatchAction()
	run := contract.Run{ID: "batch", RequestID: "batch", Version: 1, Value: json.RawMessage(`{"state":{"version":7,"revision":3,"stage":"review"}}`)}
	if err := db.CreateRun(ctx, run); err != nil {
		t.Fatal(err)
	}
	parts, err := figuredomain.PartActions(action)
	if err != nil {
		t.Fatal(err)
	}
	parentID := contract.IntentID(run, action)
	saved := run
	saved.Version++
	marshalPlan := func(action contract.Action, agent string) json.RawMessage {
		t.Helper()
		data, err := json.Marshal(reservedAction{Action: action, Version: saved.Version, MessageID: agent})
		if err != nil {
			t.Fatal(err)
		}
		return data
	}
	deadline := time.Date(2026, 1, 1, 1, 0, 0, 0, time.UTC)
	parent := contract.Intent{ID: parentID, RunID: run.ID, Action: marshalPlan(action, ""), Deadline: deadline}
	children := []contract.Intent{}
	for index, part := range parts {
		id := contract.IntentID(run, part)
		parts[index].WorkID = id
		children = append(children, contract.Intent{ID: id, RunID: run.ID, AgentID: agentID(id), Action: marshalPlan(parts[index], agentID(id)), Deadline: deadline})
	}
	if err := db.ReserveBatch(ctx, 1, saved, parent, children); err != nil {
		t.Fatal(err)
	}
	return run, action, parent, children, parts
}

func TestMIG012BatchPauseRequiresRemoteConfirmation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "private", "writing.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	run, action, parent, children, _ := reserveFixtureBatch(t, ctx, db)
	for _, child := range children[:2] {
		if ok, err := db.ClaimBatchChild(ctx, child.ID, 2); !ok || err != nil {
			t.Fatalf("could not claim fixture child: %v", err)
		}
	}
	transport := &stoppingBatchTransport{finished: children[0].AgentID, inFlight: children[1].AgentID}
	r := fixtureBatchRunner(t, db, transport, action, parent.Deadline)
	var carried *contract.Event
	r.cfg.Paused = func(run contract.Run, event *contract.Event) (contract.Run, error) {
		carried = event
		run.Version++
		return run, nil
	}
	if err := r.Pause(ctx, run.ID); !errors.Is(err, contract.ErrDeliveryUncertain) || transport.cancels != 1 {
		t.Fatalf("pause declared an unconfirmed stop: %v", err)
	}
	if ok, err := db.ClaimBatchChild(ctx, children[2].ID, 3); ok || err != nil {
		t.Fatalf("pause failed to block new children: %v", err)
	}
	pending, err := db.BatchChildren(ctx, parent.ID)
	if err != nil || pending[0].Result == nil || pending[1].Result != nil || pending[2].Failure == "" {
		t.Fatalf("pause discarded a finished peer or lost queued state: %v", err)
	}
	transport.stopped = true
	if err := r.Pause(ctx, run.ID); err != nil {
		t.Fatal(err)
	}
	if carried == nil || !strings.Contains(string(carried.Body), `"id":"f1"`) {
		t.Fatal("pause discarded the proved completed peer")
	}
	got, err := db.BatchChildren(ctx, parent.ID)
	if err != nil || len(got) != 0 {
		t.Fatalf("confirmed pause left the parent active: %v", err)
	}
}

type stoppingBatchTransport struct {
	contract.Paseo
	finished, inFlight string
	stopped            bool
	cancels            int
}

func (p *stoppingBatchTransport) Snapshot(_ context.Context, ref contract.RemoteRef) (contract.Snapshot, error) {
	status := "running"
	switch {
	case ref.AgentID == p.finished:
		status = "completed"
	case ref.AgentID == p.inFlight && p.stopped:
		status = "stopped"
	case ref.AgentID != p.inFlight:
		return contract.Snapshot{}, contract.ErrNotFound
	}
	return contract.Snapshot{Ref: contract.RemoteRef{AgentID: ref.AgentID, TurnID: ref.TurnID, Epoch: "fixture", After: 4}, Status: status}, nil
}

func (p *stoppingBatchTransport) Cancel(_ context.Context, ref contract.RemoteRef) error {
	if ref.AgentID != p.inFlight {
		return contract.ErrNotFound
	}
	p.cancels++
	return nil
}

func TestMIG012BatchDispatchesWithinChildLimit(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "private", "writing.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	run := contract.Run{ID: "batch", RequestID: "batch", Version: 1, Value: json.RawMessage(`{"state":{"version":7,"revision":3,"stage":"review"}}`)}
	if err := db.CreateRun(ctx, run); err != nil {
		t.Fatal(err)
	}
	action := testBatchAction()
	transport := &gatedBatchTransport{starts: make(chan childDispatch, 3)}
	r := fixtureBatchRunner(t, db, transport, action, time.Date(2026, 1, 1, 1, 0, 0, 0, time.UTC))
	finished := make(chan error, 1)
	go func() {
		advanced, err := r.process(ctx, run.ID, nil, true)
		if err == nil && !advanced {
			err = errors.New("initial batch did not advance")
		}
		finished <- err
	}()
	next := func() childDispatch {
		t.Helper()
		select {
		case event := <-transport.starts:
			return event
		case <-ctx.Done():
			t.Fatal("expected a child dispatch")
			return childDispatch{}
		}
	}
	first, second := next(), next()
	parentID := contract.IntentID(run, action)
	children, err := db.BatchChildren(ctx, parentID)
	if err != nil || len(children) != 3 || !children[0].Started || !children[1].Started || children[2].Started {
		t.Fatalf("parent or child exceeded the durable execution cap: %v", err)
	}
	close(second.finish)
	third := next()
	if first.agent == third.agent || second.agent == third.agent {
		t.Fatal("unexpected duplicate child")
	}
	close(first.finish)
	close(third.finish)
	select {
	case err := <-finished:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("batch did not settle after all children finished")
	}
}

type childDispatch struct {
	agent  string
	finish chan struct{}
}

type gatedBatchTransport struct {
	contract.Paseo
	starts chan childDispatch
}

func (p *gatedBatchTransport) Create(ctx context.Context, id string, _ contract.SessionSpec) (contract.RemoteRef, error) {
	start := childDispatch{agent: id, finish: make(chan struct{})}
	p.starts <- start
	select {
	case <-ctx.Done():
		return contract.RemoteRef{}, ctx.Err()
	case <-start.finish:
		return contract.RemoteRef{AgentID: id, TurnID: id}, nil
	}
}

func (*gatedBatchTransport) Snapshot(_ context.Context, ref contract.RemoteRef) (contract.Snapshot, error) {
	return contract.Snapshot{Ref: contract.RemoteRef{AgentID: ref.AgentID, TurnID: ref.TurnID, Epoch: "fixture", After: 4}, Status: "completed"}, nil
}
