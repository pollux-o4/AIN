package runtime

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
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

func TestFLOW001HTTPToHandoff(t *testing.T) {
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
	outbox := filepath.Join(t.TempDir(), "outbox")
	handler, scheduler, err := Editorial(stored, immediatePaseo{}, turns, EditorialConfig{
		Assets: fstest.MapFS{}, SessionKey: strings.Repeat("k", 32), AgentToken: token, Outbox: outbox,
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
		Version      int64
	}
	if err := json.Unmarshal(res.Body.Bytes(), &view); err != nil || res.Code != 200 ||
		view.Status != "awaiting_user" || view.HTML == "" || len(view.Artifacts) != 8 {
		t.Fatalf("unexpected completed view: status=%d state=%q artifacts=%d error=%v", res.Code, view.Status, len(view.Artifacts), err)
	}
	verifyApprovedHandoff(t, handler, run.ID, view.Version, token, outbox)
}

func verifyApprovedHandoff(t *testing.T, handler http.Handler, id string, version int64, token, outbox string) {
	t.Helper()
	session := httptest.NewRecorder()
	handler.ServeHTTP(session, httptest.NewRequest("GET", "http://localhost/write/session", nil))
	cookies := session.Result().Cookies()
	if session.Code != http.StatusNoContent || len(cookies) != 1 {
		t.Fatal("editorial UI session unavailable")
	}
	request := func(method, suffix, body string, human bool, want int) *httptest.ResponseRecorder {
		t.Helper()
		route := "http://localhost/write/api/runs/" + id + suffix
		req := httptest.NewRequest(method, route, strings.NewReader(body))
		if human {
			req.AddCookie(cookies[0])
			req.Header.Set("Origin", "http://localhost")
		} else {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		result := httptest.NewRecorder()
		handler.ServeHTTP(result, req)
		if result.Code != want {
			t.Fatalf("%s %s: got %d, want %d: %s", method, suffix, result.Code, want, result.Body)
		}
		return result
	}
	request("POST", "/handoff", "", false, http.StatusConflict)
	satisfy := fmt.Sprintf(`{"type":"satisfy","operationId":"satisfy","expectedVersion":%d}`, version)
	request("POST", "/actions", satisfy, false, http.StatusForbidden)
	request("POST", "/actions", satisfy, true, http.StatusOK)
	request("POST", "/handoff", "", false, http.StatusConflict)
	authorize := fmt.Sprintf(`{"type":"authorize_publication","operationId":"approve","expectedVersion":%d}`, version+1)
	request("POST", "/actions", authorize, true, http.StatusOK)
	txt := request("GET", "/download", "", false, http.StatusOK)
	if txt.Body.Len() == 0 {
		t.Fatal("TXT is empty")
	}
	delivery := request("POST", "/handoff", "", false, http.StatusOK)
	var bundle struct{ Path, Request string }
	if err := json.Unmarshal(delivery.Body.Bytes(), &bundle); err != nil ||
		filepath.Dir(bundle.Path) != outbox || !strings.Contains(bundle.Request, id) {
		t.Fatalf("invalid handoff: %v", err)
	}
	archive, err := zip.OpenReader(bundle.Path)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	manifest, err := archive.Open("manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	defer manifest.Close()

}
