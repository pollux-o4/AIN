package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/pollux-o4/AIN/backend/internal/editorial"
	"github.com/pollux-o4/AIN/backend/internal/httpapi"
	"github.com/pollux-o4/AIN/backend/internal/store"
	"github.com/pollux-o4/AIN/backend/internal/writing"
)

type fixtureScheduler struct{}

func (fixtureScheduler) Wake(string)                         {}
func (fixtureScheduler) Pause(context.Context, string) error { return nil }
func (fixtureScheduler) Recover(context.Context) error       { return nil }

func TestAINAPI001CreateAndReadSQLite(t *testing.T) {
	db, err := store.Open(t.Context(), filepath.Join(t.TempDir(), "private", "editorial.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mux := http.NewServeMux()
	views := editorial.Queries{Store: db}
	httpapi.ReadRoutes(mux, views)
	httpapi.CreateRoute(mux, editorial.Creator{Store: db, Rules: writing.New(), Scheduler: fixtureScheduler{}}, views)
	token := strings.Repeat("t", 32)
	handler, err := httpapi.New(fstest.MapFS{}, strings.Repeat("k", 32), token, mux)
	if err != nil {
		t.Fatal(err)
	}
	call := func(method, path, body string, status int) []byte {
		t.Helper()
		req := httptest.NewRequest(method, "http://localhost"+path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != status {
			t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
		}
		return rec.Body.Bytes()
	}
	const path = "/write/api/runs"
	var created struct{ ID, Status string }
	data := call("POST", path, `{"requestId":"e2e","idea":"합성 글감"}`, 202)
	if err := json.Unmarshal(data, &created); err != nil || created.ID == "" || created.Status != "waiting_ai" {
		t.Fatalf("unexpected create: %s (%v)", data, err)
	}
	var list struct{ Runs []struct{ ID string } }
	data = call("GET", path, "", 200)
	if err := json.Unmarshal(data, &list); err != nil || len(list.Runs) != 1 || list.Runs[0].ID != created.ID {
		t.Fatalf("unexpected list: %s (%v)", data, err)
	}
	call("GET", path+"/"+created.ID, "", 200)
	call("GET", path+"/missing", "", 404)
}
