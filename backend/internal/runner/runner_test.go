package runner

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

func TestFlow001ReservationBeforeDeliveryAndCanonicalResult(t *testing.T) {
	store := newTestStore("one")
	transport := newTestPaseo()
	transport.createHook = func(id string) error {
		pending, err := store.currentIntent("one")
		if err != nil || pending.AgentID != id || pending.Remote.AgentID != "" {
			t.Error("external creation started before durable reservation")
		}
		run, err := store.GetRun(t.Context(), "one")
		if err != nil || run.Version != 2 {
			t.Error("reservation state was not committed with intent")
		}
		return errors.New("lost response")
	}
	r := newTestRunner(t, store, transport, nil)
	stop := launch(t, r)
	defer stop()

	receive(t, transport.watching)
	transport.finish("completed")
	transport.pulse <- contract.Snapshot{Status: "completed", Body: json.RawMessage(`"stale event body"`)}
	commit := receive(t, store.committed)
	if string(commit.Value) != `"completion"` || commit.Version != 3 {
		t.Fatal("event body used in place of canonical snapshot, or version advanced incorrectly")
	}
	r.Wake("one")
	if err := r.Recover(t.Context()); err != nil {
		t.Fatal(err)
	}
	stop()
	if transport.creates.Load() != 1 || store.commitCount.Load() != 1 || transport.watchers.Load() != 0 {
		t.Fatal("duplicate wake changed delivery or application count, or watch survived shutdown")
	}
}

func TestFlow001RecoveryDoesNotReplayUncertainDelivery(t *testing.T) {
	for _, mismatched := range []bool{false, true} {
		name := "unbound agent absent"
		if mismatched {
			name = "bound agent epoch replaced"
		}
		t.Run(name, func(t *testing.T) {
			store := newTestStore("one")
			intent := reserveFixture(t, store, mismatched)
			transport := newTestPaseo()
			if mismatched {
				transport.set(contract.Snapshot{
					Status: "completed", Ref: contract.RemoteRef{AgentID: intent.AgentID, TurnID: "turn", Epoch: "changed", After: 18},
				})
			}
			issues := make(chan error, 4)
			r := newTestRunner(t, store, transport, func(cfg *Config) {
				cfg.OnError = func(_ string, err error) { issues <- err }
			})
			stop := launch(t, r)
			defer stop()
			if err := receive(t, issues); !errors.Is(err, contract.ErrDeliveryUncertain) {
				t.Fatalf("recovery error = %v", err)
			}
			if store.commitCount.Load() != 0 || transport.creates.Load() != 0 {
				t.Fatal("recovery replayed or applied an unconfirmed remote turn")
			}

			transport.set(contract.Snapshot{
				Status: "completed", Ref: contract.RemoteRef{AgentID: intent.AgentID, TurnID: "turn", Epoch: "epoch", After: 18},
				Body: json.RawMessage(`"recovered"`),
			})
			if err := r.Recover(t.Context()); err != nil {
				t.Fatal(err)
			}
			if result := receive(t, store.committed); string(result.Value) != `"recovered"` {
				t.Fatal("recovered durable intent did not apply canonical result")
			}
			stop()
			if transport.creates.Load() != 0 || store.commitCount.Load() != 1 {
				t.Fatal("recovery replayed an existing result")
			}
		})
	}
}

func TestEdit001PauseRequiresRemoteConfirmation(t *testing.T) {
	store := newTestStore("one")
	transport := newTestPaseo()
	r := newTestRunner(t, store, transport, nil)
	stop := launch(t, r)
	defer stop()
	receive(t, transport.watching)

	if err := r.Pause(t.Context(), "one"); !errors.Is(err, contract.ErrDeliveryUncertain) {
		t.Fatalf("pause with an unconfirmed stop = %v", err)
	}
	if transport.watchers.Load() != 0 || store.commitCount.Load() != 0 {
		t.Fatal("pause left a local watch or claimed completion")
	}
	transport.onCancel = func() { transport.finish("completed") }
	if err := r.Pause(t.Context(), "one"); err != nil {
		t.Fatal(err)
	}
	result := receive(t, store.committed)
	if string(result.Value) != `"paused with completion"` || transport.cancels.Load() != 2 ||
		store.commitCount.Load() != 1 {
		t.Fatal("pause did not preserve the completion racing with cancellation")
	}
}

func TestFlow001QueueOverflowAndWakeWithoutWatcherEvent(t *testing.T) {
	store := newTestStore("one", "two", "three")
	transport := newTestPaseo()
	recheck := make(chan time.Time, 1)
	timers := make(chan struct{}, 5)
	r := newTestRunner(t, store, transport, func(cfg *Config) {
		cfg.After = func(time.Duration) <-chan time.Time {
			timers <- struct{}{}
			return recheck
		}
	})
	for _, id := range []string{"one", "two", "one", "three"} {
		r.Wake(id)
	}
	stop := launch(t, r)
	defer stop()
	results := make(map[string]bool)
	for range 3 {
		receive(t, transport.watching)
		receive(t, timers)
		transport.finish("completed")
		recheck <- time.Time{}
		result := receive(t, store.committed)
		results[result.ID] = true
	}
	stop()
	if len(results) != 3 || transport.creates.Load() != 3 || transport.watchers.Load() != 0 {
		t.Fatal("queue overflow lost durable work, created duplicate work, or leaked a watch")
	}
}

func TestFlow001DeadlineCancelsAndConfirms(t *testing.T) {
	store := newTestStore("one")
	transport := newTestPaseo()
	var nanos atomic.Int64
	start := time.Date(2026, 11, 27, 0, 0, 0, 0, time.UTC)
	nanos.Store(start.UnixNano())
	timer := make(chan time.Time, 1)
	started := make(chan struct{}, 1)
	transport.onCancel = func() {
		if store.commitCount.Load() != 0 {
			t.Error("runner committed before confirming the stop")
		}
		transport.finish("stopped")
	}
	r := newTestRunner(t, store, transport, func(cfg *Config) {
		cfg.Now = func() time.Time { return time.Unix(0, nanos.Load()) }
		cfg.After = func(time.Duration) <-chan time.Time {
			started <- struct{}{}
			return timer
		}
	})
	stop := launch(t, r)
	defer stop()
	receive(t, transport.watching)
	receive(t, started)
	nanos.Add(int64(time.Minute))
	timer <- time.Time{}
	receive(t, store.committed)
	stop()
	if transport.cancels.Load() != 1 || store.commitCount.Load() != 1 || transport.watchers.Load() != 0 {
		t.Fatal("deadline did not cancel and confirm exactly once")
	}
}

func TestFlow001UncertainIntentRetainsDurableCapacity(t *testing.T) {
	store := newTestStore("one", "two")
	reserveFixture(t, store, false)
	transport := newTestPaseo()
	r := newTestRunner(t, store, transport, nil)
	if _, err := r.process(t.Context(), "two", nil, true); err != nil {
		t.Fatal(err)
	}
	if transport.creates.Load() != 0 {
		t.Fatal("unresolved remote work was excluded from the global limit")
	}
	if intent, err := store.currentIntent("two"); !errors.Is(err, contract.ErrNotFound) || intent.ID != "" {
		t.Fatal("a turn was reserved despite the global limit")
	}
}

func newTestRunner(t *testing.T, store *testStore, transport *testPaseo, tune func(*Config)) *Runner {
	t.Helper()
	clock := time.Date(2026, 11, 27, 0, 0, 0, 0, time.UTC)
	cfg := Config{
		Workers: 1, Queue: 1, TurnLimit: time.Minute, RecheckInterval: time.Second, MaxRechecks: 2,
		Now:   func() time.Time { return clock },
		After: func(time.Duration) <-chan time.Time { return nil },
		Reserve: func(run contract.Run, _ contract.Action) (contract.Run, error) {
			run.Version++
			return run, nil
		},
		Paused: func(run contract.Run, event *contract.Event) (contract.Run, error) {
			run.Version++
			run.Value = json.RawMessage(`"paused"`)
			if event != nil {
				run.Value = json.RawMessage(`"paused with completion"`)
			}
			return run, nil
		},
	}
	if tune != nil {
		tune(&cfg)
	}
	r, err := New(store, transport, testRules{}, testTurns{}, cfg)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func launch(t *testing.T, r *Runner) func() {
	t.Helper()
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() {
		defer close(done)
		if err := r.Run(ctx); err != nil {
			t.Error(err)
		}
	}()
	return func() {
		cancel()
		receive(t, done)
	}
}

func receive[T any](t *testing.T, ch <-chan T) T {
	t.Helper()
	select {
	case value := <-ch:
		return value
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for test synchronization")
		var zero T
		return zero
	}
}

func reserveFixture(t *testing.T, store *testStore, bound bool) contract.Intent {
	t.Helper()
	initial, err := store.GetRun(t.Context(), "one")
	if err != nil {
		t.Fatal(err)
	}
	action, _ := testRules{}.Next(initial)
	id := contract.IntentID(initial, action)
	updated := initial
	updated.Version++
	encoded, err := json.Marshal(reservedAction{Action: action, Version: updated.Version})
	if err != nil {
		t.Fatal(err)
	}
	intent := contract.Intent{ID: id, RunID: initial.ID, AgentID: agentID(id), Action: encoded}
	if bound {
		intent.Remote = contract.RemoteRef{AgentID: intent.AgentID, TurnID: "turn", Epoch: "epoch", After: 10}
	}
	if err := store.Reserve(t.Context(), initial.Version, updated, intent); err != nil {
		t.Fatal(err)
	}
	return intent
}

type testRules struct{}

func (testRules) Next(run contract.Run) (contract.Action, error) {
	if string(run.Value) != `"ready"` {
		return contract.Action{}, nil
	}
	return contract.Action{Kind: "request_ai", Stage: "draft"}, nil
}

func (testRules) Reduce(run contract.Run, event contract.Event) (contract.Run, error) {
	run.Version++
	run.Value = event.Body
	return run, nil
}

type testTurns struct{}

func (testTurns) BuildTurn(contract.Run, contract.Action) (contract.SessionSpec, error) {
	return contract.SessionSpec{Prompt: "synthetic"}, nil
}

func (testTurns) ValidateResult(_ contract.Action, snapshot contract.Snapshot) (contract.Event, error) {
	return contract.Event{Kind: snapshot.Status, Body: snapshot.Body}, nil
}

type testPaseo struct {
	contract.Paseo
	mu         sync.Mutex
	snapshot   contract.Snapshot
	createHook func(string) error
	onCancel   func()
	watching   chan struct{}
	pulse      chan contract.Snapshot
	creates    atomic.Int32
	cancels    atomic.Int32
	watchers   atomic.Int32
}

func newTestPaseo() *testPaseo {
	return &testPaseo{watching: make(chan struct{}, 8), pulse: make(chan contract.Snapshot, 8)}
}

func (p *testPaseo) set(snapshot contract.Snapshot) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.snapshot = snapshot
}

func (p *testPaseo) finish(status string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.snapshot.Status, p.snapshot.Body = status, json.RawMessage(`"completion"`)
	p.snapshot.Ref.After++
}

func (p *testPaseo) Create(_ context.Context, id string, _ contract.SessionSpec) (contract.RemoteRef, error) {
	p.creates.Add(1)
	ref := contract.RemoteRef{AgentID: id, TurnID: "turn", Epoch: "epoch", After: 10}
	p.set(contract.Snapshot{Ref: ref, Status: "running"})
	if p.createHook != nil {
		return contract.RemoteRef{}, p.createHook(id)
	}
	return ref, nil
}

func (p *testPaseo) Snapshot(_ context.Context, ref contract.RemoteRef) (contract.Snapshot, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.snapshot.Ref.AgentID != ref.AgentID {
		return contract.Snapshot{}, contract.ErrNotFound
	}
	return p.snapshot, nil
}

func (p *testPaseo) Watch(ctx context.Context, _ contract.RemoteRef, emit func(contract.Snapshot) error) error {
	p.watchers.Add(1)
	defer p.watchers.Add(-1)
	p.watching <- struct{}{}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case change := <-p.pulse:
			if err := emit(change); err != nil {
				return err
			}
		}
	}
}

func (p *testPaseo) Cancel(context.Context, contract.RemoteRef) error {
	p.cancels.Add(1)
	if p.onCancel != nil {
		p.onCancel()
	}
	return nil
}
