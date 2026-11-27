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
	"testing"
	"testing/fstest"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/runner"
	"github.com/pollux-o4/AIN/backend/internal/store"
)

type fixtureTurns map[string]json.RawMessage

func (f fixtureTurns) BuildTurn(_ contract.Run, a contract.Action) (contract.SessionSpec, error) {
	if f[a.Stage] == nil {
		return contract.SessionSpec{}, errors.New("missing fixture stage")
	}
	return contract.SessionSpec{Prompt: a.Stage}, nil
}

func (f fixtureTurns) ValidateResult(a contract.Action, _ contract.Snapshot) (contract.Event, error) {
	var event map[string]json.RawMessage
	if err := json.Unmarshal(f[a.Stage], &event); err != nil {
		return contract.Event{}, err
	}
	delete(event, "id")
	event["expectedVersion"], _ = json.Marshal(a.StateVersion)
	body, err := json.Marshal(event)
	return contract.Event{Actor: "adapter", Kind: "complete", Body: body}, err
}

type immediatePaseo struct{ contract.Paseo }

func (immediatePaseo) Create(_ context.Context, id string, _ contract.SessionSpec) (contract.RemoteRef, error) {
	return contract.RemoteRef{AgentID: id, TurnID: id}, nil
}
func (immediatePaseo) Snapshot(_ context.Context, ref contract.RemoteRef) (contract.Snapshot, error) {
	return contract.Snapshot{Ref: ref, Status: "completed"}, nil
}

type observedStore struct {
	contract.Store
	complete chan struct{}
}

func (s observedStore) Commit(ctx context.Context, version int64, intent string, run contract.Run) error {
	if err := s.Store.Commit(ctx, version, intent, run); err != nil {
		return err
	}
	var value struct{ State struct{ Status string } }
	if err := json.Unmarshal(run.Value, &value); err != nil {
		return err
	}
	if value.State.Status == "awaiting_user" {
		close(s.complete)
	}
	return nil
}

func TestFLOW001HTTPToReview(t *testing.T) {
	raw, err := os.ReadFile("../../../tests/migration/reference/flow-001.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Error string
		Event json.RawMessage
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	turns := fixtureTurns{}
	for _, item := range cases {
		var event struct{ Type, Stage string }
		if err := json.Unmarshal(item.Event, &event); err != nil {
			t.Fatal(err)
		}
		if event.Type == "complete" && item.Error == "" {
			turns[event.Stage] = item.Event
		}
	}
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "private", "editorial.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	stored := observedStore{Store: db, complete: make(chan struct{})}
	token := strings.Repeat("t", 32)
	handler, scheduler, err := Editorial(stored, immediatePaseo{}, turns, EditorialConfig{
		Assets: fstest.MapFS{}, SessionKey: strings.Repeat("k", 32), AgentToken: token,
		Runner: runner.Config{Workers: 1, Queue: 4, TurnLimit: time.Minute, RecheckInterval: time.Second, MaxRechecks: 1,
			OnError: func(_ string, err error) { t.Error(err) }},
	})
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- scheduler.Run(ctx) }()
	defer func() {
		cancel()
		if err := <-done; err != nil && !errors.Is(err, context.Canceled) {
			t.Error(err)
		}
	}()
	req := httptest.NewRequest("POST", "http://localhost/write/api/runs", strings.NewReader(`{"requestId":"flow","idea":"접속 장애에서 배운 점"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusAccepted {
		t.Fatalf("status=%d response=%s", res.Code, res.Body)
	}
	select {
	case <-stored.complete:
	case <-ctx.Done():
		t.Fatal("editorial run did not reach human review")
	}
	run, err := db.FindRequest(ctx, "flow")
	if err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest("GET", "http://localhost/write/api/runs/"+run.ID, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	var view struct {
		Status, HTML string
		Artifacts    []json.RawMessage
	}
	if err := json.Unmarshal(res.Body.Bytes(), &view); err != nil || res.Code != 200 ||
		view.Status != "awaiting_user" || view.HTML == "" || len(view.Artifacts) != 8 {
		t.Fatalf("unexpected completed view: status=%d state=%q artifacts=%d error=%v", res.Code, view.Status, len(view.Artifacts), err)
	}
}
