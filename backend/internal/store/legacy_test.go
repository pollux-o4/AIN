package store

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

func TestHISTORY001LegacyDataRoundTrip(t *testing.T) {
	ctx := t.Context()
	root := privateTestDir(t)
	path, jobs := filepath.Join(root, "editorial.sqlite"), filepath.Join(root, "jobs")
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatal(err)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.ExecContext(ctx, `CREATE TABLE editorial_runs (
		id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, value TEXT NOT NULL)`); err != nil {
		t.Fatal(err)
	}

	body := `{"state":{"articleId":"previous"},"ai":{"provider":"synthetic","model":"model"}}`
	jobID := digest([]byte(body))
	childID := digest([]byte("figure-child"))
	missingID := digest([]byte("no-job-file"))
	archived := fmt.Sprintf(`{"state":{"status":"completed","revision":7,"version":4},
		"archivedAt":1760000000000,"updatedAt":1760000000000,"future":{"outline":"%s"},
		"revisions":[{"revision":6,"draft":"old text"}],"events":[{"kind":"archived"}]}`, strings.Repeat("x", 2<<20))
	legacyRows := []contract.Run{
		{ID: "archived", RequestID: "old-request", Version: 4, Value: json.RawMessage(archived)},
		{ID: "previous", RequestID: "req-batch", Value: fmt.Appendf(nil, `{"pending":{"body":%s}}`, body)},
		{ID: "missing", RequestID: "req-missing", Value: fmt.Appendf(nil, `{"pending":{"jobId":"%s"}}`, missingID)},
	}
	for _, run := range legacyRows {
		if _, err := db.ExecContext(ctx, "INSERT INTO editorial_runs VALUES (?,?,?)", run.ID, run.RequestID, string(run.Value)); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	writeLegacyFixture(t, filepath.Join(jobs, jobID+".json"),
		fmt.Sprintf(`{"id":"%s","kind":"batch","parts":["%s"],"status":"running","future":{"key":"kept"}}`, jobID, childID))
	writeLegacyFixture(t, filepath.Join(jobs, childID+".json"),
		fmt.Sprintf(`{"id":"%s","parentId":"%s","agentId":"remote","status":"running","deadline":1760000030000,
			"workerBoundary":{"turnId":"prior-turn","epoch":"legacy","seq":12}}`, childID, jobID))
	writeLegacyFixture(t, filepath.Join(jobs, "workers", digest([]byte("previous"))+".json"),
		`{"writer":{"agentId":"remote","updatedAt":"2026-11-27T00:00:00Z","delivered":{"new":["a"]}}}`)

	store := openTestStore(t, path, WithLegacyPaseoRoot(jobs))
	for _, run := range legacyRows {
		assertRun(t, store, run)
	}
	got, err := store.GetRun(ctx, "archived")
	if err != nil {
		t.Fatal(err)
	}
	got.Version++
	got.Value = bytes.Replace(got.Value, []byte(`"version":4`), []byte(`"version":5`), 1)
	if err := store.UpdateRun(ctx, 4, got); err != nil {
		t.Fatal(err)
	}
	assertRun(t, store, got)

	var summaries []contract.RunSummary
	if err := store.ListSummaries(ctx, func(summary contract.RunSummary) error {
		summaries = append(summaries, summary)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	want := contract.RunSummary{ID: "archived", Status: "completed", Revision: 7, UpdatedAt: "1760000000000", Archived: true}
	if len(summaries) != 3 || summaries[0] != want || summaries[1] != (contract.RunSummary{ID: "previous"}) {
		t.Fatal("legacy run summaries differ")
	}

	var pending []LegacyPending
	if err := store.ScanLegacyPending(ctx, func(item LegacyPending) error {
		pending = append(pending, item)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if len(pending) != 2 || pending[0].RunID != "previous" || pending[0].JobID != jobID ||
		pending[0].Job == nil || len(pending[0].Job.Parts) != 1 || pending[0].Job.Parts[0] != childID ||
		pending[1].RunID != "missing" || pending[1].JobID != missingID || pending[1].Job != nil {
		t.Fatal("legacy pending records did not preserve known and missing links")
	}
	child, err := store.LegacyJob(ctx, childID)
	if err != nil {
		t.Fatal(err)
	}
	if child.ParentID != jobID || child.Remote != (contract.RemoteRef{AgentID: "remote", Epoch: "legacy", After: 12}) ||
		child.BoundaryTurnID != "prior-turn" || !child.Deadline.Equal(time.UnixMilli(1760000030000)) {
		t.Fatal("legacy child remote reference differs")
	}
	workers, err := store.LegacyWorkers(ctx, "previous")
	if err != nil {
		t.Fatal(err)
	}
	if worker := workers["writer"]; worker.AgentID != "remote" ||
		string(worker.Delivered) != `{"new":["a"]}` || worker.UpdatedAt.IsZero() {
		t.Fatal("legacy worker record differs")
	}
}

func writeLegacyFixture(t *testing.T, path, value string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(value), 0o600); err != nil {
		t.Fatal(err)
	}
}
