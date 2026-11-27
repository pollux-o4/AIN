package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

func TestMIG025SummaryUpgradeAndLegacyWrite(t *testing.T) {
	ctx := t.Context()
	path := filepath.Join(t.TempDir(), "private", "editorial.sqlite")
	if err := prepareDatabase(path); err != nil {
		t.Fatal(err)
	}
	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.ExecContext(ctx, `CREATE TABLE ain_schema_migrations (version INTEGER PRIMARY KEY)`); err != nil {
		t.Fatal(err)
	}
	for i, ddl := range migrations[:3] {
		if _, err := legacy.ExecContext(ctx, ddl); err != nil {
			t.Fatal(err)
		}
		if _, err := legacy.ExecContext(ctx, `INSERT INTO ain_schema_migrations VALUES (?)`, i+1); err != nil {
			t.Fatal(err)
		}
	}
	state := map[string]any{
		"schemaVersion": 1, "version": 1, "revision": 1, "status": "waiting_ai", "stage": "diagnose",
		"articleId": "fixture", "source": "", "idea": "대체 제목", "artifacts": map[string]any{}, "seen": map[string]any{},
		"history": []any{summaryDraft("# 이전 제목"), "old malformed element", summaryDraft("머리말\r\n#\t최신 이력 제목\r\n\r\n이전 본문")},
	}
	record := map[string]any{"state": state, "issue": "PRIVATE_TEST_DETAIL"}
	if _, err := legacy.ExecContext(ctx, `INSERT INTO editorial_runs VALUES (?, ?, ?)`, "fixture", "request", encodeSummaryFixture(t, record)); err != nil {
		t.Fatal(err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatal(err)
	}
	migrated, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	summary := readSummaryFixture(t, ctx, migrated)
	if summary.Title != "최신 이력 제목" || summary.NeedsCompletion {
		t.Fatalf("upgrade list projection: %+v", summary)
	}
	var monitor struct{ Issue string }
	if json.Unmarshal([]byte(summary.Monitor), &monitor) != nil || monitor.Issue != "확인 필요" {
		t.Fatal("private issue text entered the compact summary")
	}
	if err := migrated.Close(); err != nil {
		t.Fatal(err)
	}

	// Node can update the raw table through ordinary SQLite, without a Go
	// UDF. On the next Go open, the dirty validation is resolved.
	legacy, err = sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	state["stage"] = "draft"
	state["artifacts"] = summaryDraft("# 현재 초안 제목")["artifacts"]
	if _, err := legacy.ExecContext(ctx, `UPDATE editorial_runs SET value=? WHERE id='fixture'`, encodeSummaryFixture(t, record)); err != nil {
		t.Fatal(err)
	}
	var title string
	var dirty bool
	if err := legacy.QueryRowContext(ctx, `SELECT title, needs_completion IS NULL FROM ain_run_summaries`).Scan(&title, &dirty); err != nil ||
		title != "현재 초안 제목" || !dirty {
		t.Fatalf("legacy update did not refresh and mark validation dirty: %q, %t, %v", title, dirty, err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	summary = readSummaryFixture(t, ctx, reopened)
	if summary.Title != "현재 초안 제목" || !summary.NeedsCompletion {
		t.Fatalf("legacy update not revalidated: %+v", summary)
	}
}

func summaryDraft(text string) map[string]any {
	return map[string]any{"artifacts": map[string]any{"draft": map[string]any{"output": map[string]string{"text": text}}}}
}

func encodeSummaryFixture(t *testing.T, record map[string]any) string {
	t.Helper()
	data, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func readSummaryFixture(t *testing.T, ctx context.Context, db *SQLite) contract.RunSummary {
	t.Helper()
	var summary contract.RunSummary
	if err := db.ListSummaries(ctx, func(row contract.RunSummary) error { summary = row; return nil }); err != nil {
		t.Fatal(err)
	}
	return summary
}
