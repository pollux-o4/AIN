package sessions

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

func TestADR0013ReusableDeliveryIsFencedAndRecoverable(t *testing.T) {
	ctx := t.Context()
	path := filepath.Join(t.TempDir(), "synthetic.sqlite")
	clock := time.Date(2026, 11, 27, 0, 0, 0, 0, time.UTC)
	wire := &fakeWire{agents: map[string]*fakeAgent{}}
	cfg := Config{Owner: "/synthetic", Now: func() time.Time { return clock }}
	db, manager := openManager(t, path, wire, cfg)
	key := Key{ArticleID: "one", Role: "planner"}
	fresh, err := manager.TrackFresh(ctx, key, "job-1", "agent", "message-1", "antigravity")
	if err != nil {
		t.Fatal(err)
	}
	wire.agents["agent"] = &fakeAgent{
		labels: manager.Labels("job-1"), provider: "antigravity", model: "hydrogen", thinking: "medium",
		status: "idle", epoch: "epoch", turn: "native-1", seq: 10,
	}
	first := completed("agent", "message-1", "native-1", 10)
	if err := manager.Release(ctx, fresh, first, map[string]string{"idea": "prior"}, true); err != nil {
		t.Fatal(err)
	}
	desired := contract.SessionSpec{Provider: "antigravity", Model: "hydrogen-plus", Thinking: "high", Prompt: "synthetic delta"}
	_, err = manager.Acquire(ctx, Key{ArticleID: "one", Role: "reviewer"}, "job-2", "message-2", desired)
	wantError(t, err, ErrUnavailable)

	var leases [2]Lease
	ready, start := make(chan struct{}, 2), make(chan struct{})
	failures := make(chan error, 2)
	for i := range 2 {
		go func() {
			ready <- struct{}{}
			<-start
			var err error
			leases[i], err = manager.Acquire(ctx, key, fmt.Sprintf("job-%d", i+2), fmt.Sprintf("message-%d", i+2), desired)
			failures <- err
		}()
	}
	<-ready
	<-ready
	close(start)
	successes := 0
	for range 2 {
		err := <-failures
		if err == nil {
			successes++
		} else {
			wantError(t, err, ErrUnavailable)
		}
	}
	if successes != 1 {
		t.Fatalf("successful role claims = %d", successes)
	}
	lease := leases[0]
	if lease.AgentID() == "" {
		lease = leases[1]
	}
	if lease.Delivered()["idea"] != "prior" {
		t.Fatal("reuse did not restore previous delivery fingerprints")
	}

	wire.sendErr = errors.New("lost send acknowledgement")
	persisted := false
	err = manager.Dispatch(ctx, lease, desired, func(_ context.Context, assignment Assignment) error {
		if len(wire.mutations) != 0 || assignment.Remote.AgentID != "agent" || assignment.MessageID != lease.worker.MessageID ||
			assignment.Boundary.Epoch != "epoch" || assignment.Boundary.After != 10 ||
			assignment.Boundary.DaemonTurnID != "native-1" || assignment.Boundary.Usage["inputTokens"] != 42 {
			t.Fatal("remote mutations or a missing boundary preceded persistence")
		}
		persisted = true
		return nil
	})
	wantError(t, err, contract.ErrDeliveryUncertain)
	if !persisted || !slices.Equal(wire.mutations, []string{"model", "thinking", "send"}) || wire.lastMessage != lease.worker.MessageID {
		t.Fatal("reused prompt was not sent under the persisted client identity")
	}
	wantError(t, manager.Dispatch(ctx, lease, desired, func(context.Context, Assignment) error { return nil }), contract.ErrConflict)
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	_, manager = openManager(t, path, wire, cfg)
	recovered, err := manager.Recover(ctx, "agent", lease.worker.JobID)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.ProvesResult(first) || recovered.ProvesResult(completed("agent", lease.worker.MessageID, "native-1", 20)) {
		t.Fatal("previous result crossed the saved turn boundary")
	}
	now := completed("agent", lease.worker.MessageID, "native-2", 20)
	if !recovered.ProvesResult(now) {
		t.Fatal("exact new result did not cross the saved boundary")
	}
	if recovered.TurnUsage(now, map[string]int64{"inputTokens": 42}) != nil ||
		recovered.TurnUsage(now, map[string]int64{"inputTokens": 43})["inputTokens"] != 43 {
		t.Fatal("stale provider usage was attributed to a new turn")
	}
	wire.agents["agent"].turn, wire.agents["agent"].seq = "native-2", 20
	if err := manager.Release(ctx, recovered, now, map[string]string{"idea": "updated"}, true); err != nil {
		t.Fatal(err)
	}
	if len(wire.mutations) != 3 {
		t.Fatal("recovering or releasing an acknowledged turn replayed its send")
	}
}

func TestADR0015SweepOwnershipWarmLimitAndRetry(t *testing.T) {
	ctx := t.Context()
	clock := time.Date(2026, 11, 27, 0, 0, 0, 0, time.UTC)
	wire := &fakeWire{agents: map[string]*fakeAgent{}, failArchive: "old"}
	policy := DefaultPolicy()
	policy.MaxWarm = 1
	_, manager := openManager(t, filepath.Join(t.TempDir(), "synthetic.sqlite"), wire, Config{
		Owner: "/synthetic", LegacyOwner: "/synthetic-legacy", Policy: policy, Now: func() time.Time { return clock },
	})
	track := func(id string, release bool) {
		t.Helper()
		lease, err := manager.TrackFresh(ctx, Key{ArticleID: id, Role: "planner"}, id, id, "msg", "antigravity")
		if err != nil {
			t.Fatal(err)
		}
		wire.agents[id] = &fakeAgent{labels: manager.Labels(id), provider: "antigravity", model: "model",
			status: "idle", epoch: "epoch", turn: "turn", seq: 10}
		if release {
			if err := manager.Release(ctx, lease, completed(id, "msg", "turn", 10), nil, true); err != nil {
				t.Fatal(err)
			}
		}
	}
	track("old", true)
	clock = clock.Add(time.Second)
	track("new", true)
	track("active", false)
	track("foreign", false)
	wire.agents["foreign"].labels["owner"] = "/different-project"
	clock = clock.Add(policy.Grace)
	isActive := func(_ context.Context, id string) (bool, error) { return id == "active", nil }
	result, err := manager.Sweep(ctx, isActive, false)
	if err != nil || result.Warm != 1 || result.Deferred != 1 || result.Foreign != 1 || result.Archived != 0 {
		t.Fatalf("initial sweep = %+v, %v", result, err)
	}
	if _, err := manager.Sweep(ctx, isActive, false); err != nil || !slices.Equal(wire.archives, []string{"old"}) {
		t.Fatal("an archive was retried before its recorded deadline")
	}
	clock = clock.Add(policy.RetryBase)
	wire.failArchive = ""
	result, err = manager.Sweep(ctx, isActive, false)
	if err != nil || result.Archived != 1 || !slices.Equal(wire.archives, []string{"old", "old"}) {
		t.Fatalf("retry sweep = %+v, %v", result, err)
	}

	clock = clock.Add(policy.WarmIdle)
	result, err = manager.Sweep(ctx, isActive, false)
	if err != nil || result.Warm != 0 || result.Archived != 1 || !slices.Equal(wire.archives, []string{"old", "old", "new"}) {
		t.Fatalf("expiry sweep = %+v, %v", result, err)
	}
}

func TestADR0015LegacyAdoptionRequiresJobAndRemoteOwner(t *testing.T) {
	ctx := t.Context()
	now := time.Date(2026, 11, 27, 0, 0, 0, 0, time.UTC)
	wire := &fakeWire{agents: map[string]*fakeAgent{
		"legacy": {labels: map[string]string{"source": "ain-n8n", "owner": "/other", "job": "legacy-job"},
			provider: "antigravity", status: "idle", epoch: "epoch", turn: "prior", seq: 19},
	}}
	_, manager := openManager(t, filepath.Join(t.TempDir(), "synthetic.sqlite"), wire, Config{
		Owner: "/synthetic", LegacyOwner: "/known", Now: func() time.Time { return now },
	})
	record := LegacyWorker{Key: Key{ArticleID: "legacy", Role: "planner"}, WorkerAgentID: "legacy", JobAgentID: "different",
		JobID: "legacy-job", Provider: "antigravity", UpdatedAt: now}
	wantError(t, manager.ImportLegacy(ctx, record), ErrOwnership)
	record.JobAgentID = "legacy"
	wantError(t, manager.ImportLegacy(ctx, record), ErrOwnership)
	wire.agents["legacy"].labels["owner"] = "/known"
	if err := manager.ImportLegacy(ctx, record); err != nil {
		t.Fatal(err)
	}
	result, err := manager.Sweep(ctx, func(context.Context, string) (bool, error) { return false, nil }, true)
	if err != nil || result.Archived != 1 || !slices.Equal(wire.archives, []string{"legacy"}) {
		t.Fatalf("shutdown sweep = %+v, %v", result, err)
	}
}

func completed(agent, message, native string, seq int64) contract.Snapshot {
	body, _ := json.Marshal(map[string]string{"daemonTurnId": native, "text": "synthetic"})
	return contract.Snapshot{Status: "completed", Ref: contract.RemoteRef{AgentID: agent, TurnID: message, Epoch: "epoch", After: seq}, Body: body}
}

func openManager(t *testing.T, name string, wire Wire, cfg Config) (*sql.DB, *Manager) {
	t.Helper()
	db, err := sql.Open("sqlite", name)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	registry, err := NewRegistry(t.Context(), db)
	if err != nil {
		t.Fatal(err)
	}
	manager, err := New(registry, wire, cfg)
	if err != nil {
		t.Fatal(err)
	}
	return db, manager
}

func wantError(t *testing.T, got, want error) {
	t.Helper()
	if !errors.Is(got, want) {
		t.Fatalf("error = %v, want %v", got, want)
	}
}

type fakeAgent struct {
	labels                                         map[string]string
	provider, model, thinking, status, epoch, turn string
	seq                                            int64
}

type fakeWire struct {
	mu                       sync.Mutex
	agents                   map[string]*fakeAgent
	mutations, archives      []string
	lastMessage, failArchive string
	sendErr                  error
}

func (f *fakeWire) Snapshot(_ context.Context, ref contract.RemoteRef) (contract.Snapshot, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	agent := f.agents[ref.AgentID]
	if agent == nil {
		return contract.Snapshot{}, contract.ErrNotFound
	}
	body, _ := json.Marshal(map[string]any{"agent": map[string]any{
		"id": ref.AgentID, "provider": agent.provider, "model": agent.model, "thinkingOptionId": agent.thinking,
		"status": agent.status, "labels": agent.labels, "activeTurn": nil,
		"lastUsage": map[string]any{"inputTokens": 42, "other": map[string]any{"metadata": true}},
	}, "entries": []map[string]any{{"turnId": agent.turn, "seqEnd": agent.seq}}})
	return contract.Snapshot{Status: agent.status, Ref: contract.RemoteRef{AgentID: ref.AgentID, Epoch: agent.epoch, After: agent.seq}, Body: body}, nil
}

func (f *fakeWire) Send(_ context.Context, ref contract.RemoteRef, _ string) error {
	f.mutations = append(f.mutations, "send")
	f.lastMessage = ref.TurnID
	return f.sendErr
}

func (f *fakeWire) SetModel(_ context.Context, ref contract.RemoteRef, model string) error {
	f.mutations = append(f.mutations, "model")
	f.agents[ref.AgentID].model = model
	return nil
}

func (f *fakeWire) SetThinking(_ context.Context, ref contract.RemoteRef, thinking string) error {
	f.mutations = append(f.mutations, "thinking")
	f.agents[ref.AgentID].thinking = thinking
	return nil
}

func (f *fakeWire) Archive(_ context.Context, ref contract.RemoteRef) error {
	f.archives = append(f.archives, ref.AgentID)
	if ref.AgentID == f.failArchive {
		return errors.New("lost archive acknowledgement")
	}
	delete(f.agents, ref.AgentID)
	return nil
}
