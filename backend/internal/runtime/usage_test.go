package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/editorial"
	"github.com/pollux-o4/AIN/backend/internal/runner"
	"github.com/pollux-o4/AIN/backend/internal/store"
)

type usageFixturePaseo struct {
	contract.Paseo
	mu      sync.Mutex
	first   string
	watched bool
}

func (p *usageFixturePaseo) Create(_ context.Context, id string, _ contract.SessionSpec) (contract.RemoteRef, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.first == "" {
		p.first = id
	}
	return contract.RemoteRef{AgentID: id, TurnID: id}, nil
}

func usageFixtureSnapshot(ref contract.RemoteRef, status string) contract.Snapshot {
	ref.Epoch = "fixture-epoch"
	ref.After = 10
	body := json.RawMessage(`{"daemonTurnId":"fixture-native","text":"validated fixture"}`)
	return contract.Snapshot{Ref: ref, Status: status, Body: body}
}

func (p *usageFixturePaseo) Snapshot(_ context.Context, ref contract.RemoteRef) (contract.Snapshot, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if ref.AgentID == p.first && !p.watched {
		return usageFixtureSnapshot(ref, "running"), nil
	}
	return usageFixtureSnapshot(ref, "completed"), nil
}

func (p *usageFixturePaseo) Watch(ctx context.Context, ref contract.RemoteRef, emit func(contract.Snapshot) error) error {
	p.mu.Lock()
	p.watched = true
	p.mu.Unlock()
	snapshot := usageFixtureSnapshot(ref, "completed")
	snapshot.Usage = &contract.TurnUsage{InputTokens: 10, OutputTokens: 7}
	if err := emit(snapshot); err != nil {
		return err
	}
	<-ctx.Done()
	return ctx.Err()
}

func TestCorrelatedUsageSurvivesSQLiteReopen(t *testing.T) {
	raw, err := os.ReadFile("../../../tests/migration/reference/flow-001.json")
	if err != nil {
		t.Fatal(err)
	}
	var golden []struct {
		Error string
		Event json.RawMessage
	}
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatal(err)
	}
	turns := fixtureTurns{}
	for _, item := range golden {
		var event struct{ Type, Stage string }
		if err := json.Unmarshal(item.Event, &event); err != nil {
			t.Fatal(err)
		}
		if item.Error == "" && event.Type == "complete" {
			turns[event.Stage] = item.Event
		}
	}
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	path := filepath.Join(t.TempDir(), "private", "editorial.sqlite")
	db, err := store.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	completed := make(chan struct{})
	stored := observedStore{Store: db, complete: completed}
	token := strings.Repeat("t", 32)
	handler, scheduler, err := Editorial(stored, &usageFixturePaseo{}, turns, EditorialConfig{
		Assets: fstest.MapFS{}, SessionKey: strings.Repeat("k", 32), AgentToken: token,
		Runner: runner.Config{Workers: 1, Queue: 4, TurnLimit: time.Minute, RecheckInterval: time.Second, MaxRechecks: 1,
			After:   func(time.Duration) <-chan time.Time { return nil },
			OnError: func(_ string, err error) { t.Error(err) }},
	})
	if err != nil {
		t.Fatal(err)
	}
	runnerCtx, stop := context.WithCancel(ctx)
	defer stop()
	done := make(chan error, 1)
	go func() { done <- scheduler.Run(runnerCtx) }()
	req := httptest.NewRequest("POST", "http://localhost/write/api/runs",
		strings.NewReader(`{"requestId":"usage-reopen","idea":"합성 사용량 예제"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusAccepted {
		t.Fatalf("create: %d", res.Code)
	}
	select {
	case <-completed:
	case <-ctx.Done():
		t.Fatal("the fixture did not complete")
	}
	stop()
	if err := <-done; err != nil && !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := store.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	run, err := reopened.FindRequest(ctx, "usage-reopen")
	if err != nil {
		t.Fatal(err)
	}
	var durable struct {
		Events []struct {
			Kind  string
			Usage *contract.TurnUsage
		}
	}
	if err := json.Unmarshal(run.Value, &durable); err != nil {
		t.Fatal(err)
	}
	reports := 0
	for _, event := range durable.Events {
		if event.Usage != nil {
			reports++
			if event.Kind != "ai_completed" || *event.Usage != (contract.TurnUsage{InputTokens: 10, OutputTokens: 7}) {
				t.Fatal("unexpected usage in persisted event")
			}
		}
	}
	if reports != 1 {
		t.Fatalf("expected one correlated usage record, got %d", reports)
	}
	q := editorial.Queries{Store: reopened}
	history, err := q.HistoryView(ctx, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	var view struct {
		Usage struct {
			Calls     int
			Tokens    *int64
			Revisions []struct {
				Stages []struct{ Attempts []struct{ Tokens *int64 } }
			}
		}
	}
	if err := json.Unmarshal(history, &view); err != nil {
		t.Fatal(err)
	}
	if view.Usage.Tokens == nil || *view.Usage.Tokens != 17 || view.Usage.Calls != 8 {
		t.Fatalf("unexpected usage after reopening: %#v", view.Usage)
	}
	stages := view.Usage.Revisions[0].Stages
	if stages[0].Attempts[0].Tokens == nil || *stages[0].Attempts[0].Tokens != 17 ||
		stages[1].Attempts[0].Tokens != nil {
		t.Fatal("unobserved attempts must remain null")
	}
	detail, err := q.RunView(ctx, run.ID)
	if err != nil || strings.Contains(string(detail), "inputTokens") {
		t.Fatalf("stored usage leaked into the detail event: %v", err)
	}
}
