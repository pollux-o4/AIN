package runtime

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

func TestLIVE001RebindDropsOldTurnAndReleasesWatches(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	ticks := make(chan time.Time, 1)
	db := &activityFixtureStore{}
	wire := activityFixtureWire{sessions: make(chan activityFixtureSubscription, 2)}
	source := activitySource{
		store: db, watcher: wire, rules: activityFixtureRules{},
		ticks: func() (<-chan time.Time, func()) { return ticks, func() {} },
	}
	db.save(t, 1, 1, 1, "draft", "waiting_ai", "intent-old", "agent-old", "message-old")
	out, stop, err := source.OpenActivity(ctx, "article")
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	old := waitActivitySubscription(t, ctx, wire.sessions)
	if old.ref.AgentID != "agent-old" || old.ref.TurnID != "message-old" {
		t.Fatalf("wrong old activity binding: %+v", old.ref)
	}
	old.samples <- activityTimeline(t, old.ref, "epoch-1", "native-old", "첫 회차 공개 진행")
	frame := waitActivityFrame(t, ctx, out, func(frame publicActivity) bool { return frame.Text != "" })
	if frame.Revision != 1 || frame.Stage != "draft" || frame.Phase != "tool" || !frame.Active {
		t.Fatalf("unexpected first activity: %+v", frame)
	}
	encoded, _ := json.Marshal(frame)
	for _, secret := range []string{"USER_PROMPT", "INTERNAL_REASONING", "UNVALIDATED_JSON", "TOOL_ARGUMENT", "DIFFERENT_TURN"} {
		if strings.Contains(string(encoded), secret) {
			t.Fatal("private content entered activity")
		}
	}

	// Writing has advanced, but the prior socket still has a queued update.
	// Processing that update alone rechecks the durable generation.
	db.save(t, 2, 2, 2, "draft", "waiting_ai", "intent-new", "agent-new", "message-new")
	old.samples <- activityTimeline(t, old.ref, "epoch-1", "native-old", "이전 회차 신호")
	newWatch := waitActivitySubscription(t, ctx, wire.sessions)
	if newWatch.ref.AgentID != "agent-new" || newWatch.ref.TurnID != "message-new" {
		t.Fatalf("wrong new activity binding: %+v", newWatch.ref)
	}
	select {
	case <-old.closed:
	default:
		t.Fatal("old socket remained open when the next was subscribed")
	}
	newWatch.samples <- activityTimeline(t, newWatch.ref, "epoch-2", "native-new", "새 회차 공개 진행")
	frame = waitActivityFrame(t, ctx, out, func(frame publicActivity) bool {
		if strings.Contains(frame.Text, "이전 회차 신호") {
			t.Fatal("previous generation reached the HTTP buffer")
		}
		return frame.Revision == 2 && frame.Text != ""
	})
	if frame.Text != "새 회차 공개 진행" {
		t.Fatalf("wrong current messages: %s", frame.Text)
	}

	// The agent ID stayed the same but its timeline was replaced.
	newWatch.samples <- activityTimeline(t, newWatch.ref, "different-epoch", "new-native", "교체된 타임라인 혼입")
	frame = waitActivityFrame(t, ctx, out, func(frame publicActivity) bool { return frame.Phase == "unavailable" })
	if frame.Text != "" {
		t.Fatal("replaced epoch retained or exposed stale text")
	}

	db.save(t, 3, 3, 2, "review", "awaiting_user", "", "", "")
	ticks <- time.Time{}
	frame = waitActivityFrame(t, ctx, out, func(frame publicActivity) bool { return !frame.Active })
	if frame.Phase != "complete" || frame.Text != "" {
		t.Fatalf("unexpected durable completion frame: %+v", frame)
	}
	stop()
	select {
	case <-newWatch.closed:
	default:
		t.Fatal("stream close did not synchronously finish the remote watch")
	}
}

func TestLIVE001BoundedBufferAndClientCancel(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	db := &activityFixtureStore{}
	db.save(t, 1, 1, 1, "review", "waiting_ai", "active", "agent", "message")
	wire := activityFixtureWire{sessions: make(chan activityFixtureSubscription, 1)}
	source := activitySource{store: db, watcher: wire, rules: activityFixtureRules{}, ticks: func() (<-chan time.Time, func()) {
		return nil, func() {}
	}}
	subscriber, cancelSubscriber := context.WithCancel(ctx)
	out, stop, err := source.OpenActivity(subscriber, "article")
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	watch := waitActivitySubscription(t, ctx, wire.sessions)
	for i := 0; i < 12; i++ {
		watch.samples <- activityTimeline(t, watch.ref, "epoch", "native-turn", "공개 피드의 최근 상태")
	}
	if cap(out) != 1 || len(out) > 1 {
		t.Fatal("slow browser grew the activity queue")
	}
	cancelSubscriber()
	stop()
	select {
	case <-watch.closed:
	default:
		t.Fatal("cancelled browser left a remote subscription")
	}
}

type activityFixtureRules struct{ contract.EditorialRules }

func (activityFixtureRules) Next(run contract.Run) (contract.Action, error) {
	var record struct {
		State struct {
			Version       int64
			Stage, Status string
		}
	}
	if err := json.Unmarshal(run.Value, &record); err != nil {
		return contract.Action{}, err
	}
	if !isPendingActivity(record.State.Status) {
		return contract.Action{}, nil
	}
	return contract.Action{Kind: "request_ai", Stage: record.State.Stage, StateVersion: record.State.Version}, nil
}

type activityFixtureStore struct {
	contract.Store
	mu      sync.Mutex
	run     contract.Run
	pending contract.Intent
}

func (store *activityFixtureStore) save(t *testing.T, version, stateVersion, revision int64, stage, status, id, agent, message string) {
	t.Helper()
	store.mu.Lock()
	defer store.mu.Unlock()
	store.run = contract.Run{ID: "article", Version: version, Value: activityJSON(t, map[string]any{
		"state": map[string]any{"version": stateVersion, "revision": revision, "stage": stage, "status": status},
	})}
	store.pending = contract.Intent{ID: id, RunID: "article", AgentID: agent, Action: activityJSON(t, activityPlan{
		Action: contract.Action{Stage: stage, StateVersion: stateVersion}, Version: version, MessageID: message,
	})}
}

func (store *activityFixtureStore) GetRun(_ context.Context, id string) (contract.Run, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if id != store.run.ID {
		return contract.Run{}, contract.ErrNotFound
	}
	return store.run, nil
}

func (store *activityFixtureStore) PendingRun(_ context.Context, id string) (contract.Intent, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if id != store.pending.RunID || store.pending.ID == "" {
		return contract.Intent{}, contract.ErrNotFound
	}
	return store.pending, nil
}

type activityFixtureWire struct {
	contract.Paseo
	sessions chan activityFixtureSubscription
}

type activityFixtureSubscription struct {
	ref     contract.RemoteRef
	samples chan contract.Snapshot
	closed  chan struct{}
}

func (w activityFixtureWire) Watch(ctx context.Context, ref contract.RemoteRef, emit func(contract.Snapshot) error) error {
	sub := activityFixtureSubscription{ref: ref, samples: make(chan contract.Snapshot, 16), closed: make(chan struct{})}
	defer close(sub.closed)
	select {
	case <-ctx.Done():
		return ctx.Err()
	case w.sessions <- sub:
	}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case sample := <-sub.samples:
			if err := emit(sample); err != nil {
				return err
			}
		}
	}
}

func waitActivitySubscription(t *testing.T, ctx context.Context, subs <-chan activityFixtureSubscription) activityFixtureSubscription {
	t.Helper()
	select {
	case sub := <-subs:
		return sub
	case <-ctx.Done():
		t.Fatal("timed out waiting for subscription")
		return activityFixtureSubscription{}
	}
}

func waitActivityFrame(t *testing.T, ctx context.Context, out <-chan json.RawMessage, accept func(publicActivity) bool) publicActivity {
	t.Helper()
	for {
		select {
		case body, open := <-out:
			if !open {
				t.Fatal("activity stream closed before expected frame")
			}
			var frame publicActivity
			if err := json.Unmarshal(body, &frame); err != nil {
				t.Fatal(err)
			}
			if accept(frame) {
				return frame
			}
		case <-ctx.Done():
			t.Fatal("timed out waiting for activity")
		}
	}
}

func activityTimeline(t *testing.T, ref contract.RemoteRef, epoch, native, notice string) contract.Snapshot {
	t.Helper()
	entry := func(seq int, turn, kind, value string) map[string]any {
		return map[string]any{"seqStart": seq, "seqEnd": seq, "turnId": turn, "timestamp": "2026-01-01T00:00:00Z",
			"item": map[string]any{"type": kind, "text": value, "clientMessageId": ref.TurnID, "status": "running",
				"detail": map[string]any{"type": "read", "args": "TOOL_ARGUMENT"}},
		}
	}
	ref.Epoch, ref.After = epoch, 6
	body := activityJSON(t, map[string]any{
		"agent": map[string]any{"id": ref.AgentID, "status": "running", "activeTurn": map[string]any{"turnId": native}},
		"entries": []map[string]any{
			entry(1, native, "user_message", "USER_PROMPT"),
			entry(2, native, "reasoning", "INTERNAL_REASONING"),
			entry(3, native, "assistant_message", `{"draft":"UNVALIDATED_JSON"}`),
			entry(4, native, "assistant_message", notice),
			entry(5, "foreign", "assistant_message", "DIFFERENT_TURN"),
			entry(6, native, "tool_call", "TOOL_ARGUMENT"),
		},
	})
	return contract.Snapshot{Ref: ref, Status: "running", Body: body}
}

func activityJSON(t *testing.T, value any) json.RawMessage {
	t.Helper()
	body, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return body
}
