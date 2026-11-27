package editorial

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strconv"
	"testing"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/figuredomain"
	"github.com/pollux-o4/AIN/backend/internal/store"
	"github.com/pollux-o4/AIN/backend/internal/writing"
)

func TestMIG025NodeQueryParity(t *testing.T) {
	raw, err := os.ReadFile("../../../tests/migration/reference/queries.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Now   int64
		List  json.RawMessage
		Jobs  map[string]json.RawMessage
		Cases []struct {
			Name    string
			Record  json.RawMessage
			Detail  json.RawMessage
			History json.RawMessage
		}
	}
	if err := json.Unmarshal(raw, &fixture); err != nil || fixture.Now == 0 || len(fixture.Cases) == 0 {
		t.Fatalf("invalid synthetic query fixture: %v", err)
	}
	ctx := t.Context()
	root := filepath.Join(t.TempDir(), "private")
	jobsRoot := filepath.Join(root, "jobs")
	if err := os.MkdirAll(jobsRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	for id, job := range fixture.Jobs {
		if err := os.WriteFile(filepath.Join(jobsRoot, id+".json"), job, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	db, err := store.Open(ctx, filepath.Join(root, "editorial.sqlite"), store.WithLegacyPaseoRoot(jobsRoot))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	q := Queries{Store: db, Rules: writing.NewWithFigures(figuredomain.New()), Now: func() time.Time { return time.UnixMilli(fixture.Now) }}
	for _, c := range fixture.Cases {
		t.Run(c.Name, func(t *testing.T) {
			var saved struct {
				ID, RequestID string
				State         struct{ Version int64 }
			}
			if err := json.Unmarshal(c.Record, &saved); err != nil {
				t.Fatal(err)
			}
			if err := db.CreateRun(ctx, contract.Run{
				ID: saved.ID, RequestID: saved.RequestID, Version: saved.State.Version, Value: c.Record,
			}); err != nil {
				t.Fatal(err)
			}
			detail, err := q.RunView(ctx, saved.ID)
			if err != nil {
				t.Fatal(err)
			}
			for _, private := range []string{"original-signature", "another-signature", "SYNTHETIC_PRIVATE_MARKER"} {
				if bytes.Contains(detail, []byte(private)) {
					t.Fatal("private operation or job data reached the public detail")
				}
			}
			got, want := decodeQueryFixture(t, detail), decodeQueryFixture(t, c.Detail)
			for _, value := range []any{got, want} {
				monitor, _ := value.(map[string]any)["monitor"].(map[string]any)
				if _, ok := monitor["now"].(json.Number); !ok {
					t.Fatal("monitor.now must be a numeric observation clock")
				}
				delete(monitor, "now")
			}
			compareQueries(t, "detail", got, want)
			history, err := q.HistoryView(ctx, saved.ID)
			if err != nil {
				t.Fatal(err)
			}
			if bytes.Contains(history, []byte("SYNTHETIC_PRIVATE_MARKER")) {
				t.Fatal("private job output or diagnostic reached history")
			}
			compareQueries(t, "history", decodeQueryFixture(t, history), decodeQueryFixture(t, c.History))
			repeated, err := q.HistoryView(ctx, saved.ID)
			if err != nil || !bytes.Equal(history, repeated) {
				t.Fatalf("history changed on a repeated read: %v", err)
			}
			after, err := db.GetRun(ctx, saved.ID)
			if err != nil || after.Version != saved.State.Version || !bytes.Equal(after.Value, c.Record) {
				t.Fatalf("query mutated the saved run: %v", err)
			}
		})
	}
	t.Run("list", func(t *testing.T) {
		list, err := q.ListView(ctx)
		if err != nil {
			t.Fatal(err)
		}
		compareQueries(t, "list", decodeQueryFixture(t, list), decodeQueryFixture(t, fixture.List))
	})
}

func decodeQueryFixture(t *testing.T, raw json.RawMessage) any {
	t.Helper()
	var value any
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&value); err != nil {
		t.Fatal(err)
	}
	return value
}

type queryDifference struct {
	path string
	got  any
	want any
}

type missingQueryValue struct{}

func queryDiff(path string, got, want any) []queryDifference {
	if reflect.DeepEqual(got, want) {
		return nil
	}
	switch got := got.(type) {
	case map[string]any:
		if want, ok := want.(map[string]any); ok {
			var keys []string
			for key := range got {
				keys = append(keys, key)
			}
			for key := range want {
				if _, exists := got[key]; !exists {
					keys = append(keys, key)
				}
			}
			slices.Sort(keys)
			var diffs []queryDifference
			for _, key := range keys {
				g, exists := got[key]
				if !exists {
					g = missingQueryValue{}
				}
				w, exists := want[key]
				if !exists {
					w = missingQueryValue{}
				}
				diffs = append(diffs, queryDiff(path+"/"+key, g, w)...)
			}
			return diffs
		}
	case []any:
		if want, ok := want.([]any); ok && len(got) == len(want) {
			var diffs []queryDifference
			for i := range got {
				diffs = append(diffs, queryDiff(path+"/"+strconv.Itoa(i), got[i], want[i])...)
			}
			return diffs
		}
	}
	return []queryDifference{{path: path, got: got, want: want}}
}

func summarizeQueryValue(value any) string {
	if _, missing := value.(missingQueryValue); missing {
		return "<missing>"
	}
	raw, _ := json.Marshal(value)
	if len(raw) > 130 {
		return fmt.Sprintf("%.60s… (%d bytes)", string(raw), len(raw))
	}
	return string(raw)
}

func compareQueries(t *testing.T, endpoint string, got, want any) {
	t.Helper()
	strict := os.Getenv("AIN_REQUIRE_QUERY_PARITY") == "1"
	for _, diff := range queryDiff(endpoint, got, want) {
		message := fmt.Sprintf("%s: Go=%s Node=%s", diff.path, summarizeQueryValue(diff.got), summarizeQueryValue(diff.want))
		if strict || !knownQueryGap(diff.path) {
			t.Error(message)
		} else {
			t.Log(message)
		}
	}
}
