package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/store"
)

const savedRun = `{"id":"saved","requestId":"request-saved","archivedAt":1760000000123,
 "state":{"articleId":"saved","status":"publication_ready","revision":2,"version":12,
 "approval":{"revision":2,"figures":["f1"]},"history":[{"revision":1,"artifacts":{"draft":{"output":{"text":"이전\r\n초안"}}}}],
 "artifacts":{"draft":{"output":{"text":"# 최종\n\n원고 & 회차"}}}},
 "worker":{"executionId":"legacy-n8n-1"},"future":{"usage":[10,20]}}`

func privateFixtureDir(t *testing.T) string {
	t.Helper()
	path := t.TempDir()
	if err := os.Chmod(path, 0o700); err != nil {
		t.Fatal(err)
	}
	return path
}

func writeFixture(t *testing.T, path, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o600); err != nil {
		t.Fatal(err)
	}
}

func legacyFixture(t *testing.T, wal bool) (string, *sql.DB) {
	t.Helper()
	source := privateFixtureDir(t)
	path := filepath.Join(source, "ai-runtime", "editorial.sqlite")
	writeFixture(t, path, "")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if wal {
		if _, err := db.ExecContext(t.Context(), "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.ExecContext(t.Context(), "CREATE TABLE editorial_runs(id TEXT PRIMARY KEY,request_id TEXT UNIQUE NOT NULL,value TEXT NOT NULL)"); err != nil {
		t.Fatal(err)
	}
	insert(t, db, "saved", savedRun)
	t.Cleanup(func() { _ = db.Close() })
	return source, db
}

func insert(t *testing.T, db *sql.DB, id, raw string) {
	t.Helper()
	if _, err := db.ExecContext(t.Context(), "INSERT INTO editorial_runs VALUES(?,?,?)", id, "request-"+id, raw); err != nil {
		t.Fatal(err)
	}
}

func closeFixture(t *testing.T, db *sql.DB) {
	t.Helper()
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
}

func noWriter(context.Context, string) error { return nil }

func TestOfflineMigrationAndRollback(t *testing.T) {
	ctx := t.Context()
	source, legacy := legacyFixture(t, false)
	parent, child := strings.Repeat("a", 64), strings.Repeat("b", 64)
	insert(t, legacy, "linked", `{"state":{"articleId":"linked","status":"waiting_figure","revision":1,"version":7},"pending":{"jobId":"`+parent+`"}}`)
	insert(t, legacy, "ambiguous", `{"state":{"articleId":"ambiguous","status":"waiting_route","revision":2,"version":3},"pending":{"body":{"x":"old field order"}}}`)
	insert(t, legacy, "missing", `{"state":{"articleId":"missing","status":"waiting_ai","revision":1,"version":2},"pending":{"jobId":"`+strings.Repeat("c", 64)+`"}}`)
	closeFixture(t, legacy)
	writeFixture(t, filepath.Join(source, "ai-runtime", "jobs", parent+".json"), `{"id":"`+parent+`","status":"completed","agentId":"attached","parts":["`+child+`"],"workerBoundary":{"turnId":"earlier","epoch":"timeline","seq":11},"usage":{"inputTokens":3}}`)
	writeFixture(t, filepath.Join(source, "ai-runtime", "jobs", child+".json"), `{"id":"`+child+`","status":"failed","parentId":"`+parent+`","agentId":"old-child"}`)
	writeFixture(t, filepath.Join(source, "ai-runtime", "jobs", "workers", "legacy.json"), `{"writer":{"agentId":"attached"}}`)
	writeFixture(t, filepath.Join(source, "ai-runtime", "workspaces", "artifact.txt"), "작업 원본\x00")
	writeFixture(t, filepath.Join(source, "ai-runtime", "agent-token"), "fixture-only token")
	writeFixture(t, filepath.Join(source, "n8n", "dev-account.json"), `{"password":"fixture-only"}`)
	writeFixture(t, filepath.Join(source, "n8n", ".n8n", "database.sqlite"), "private fixture execution history")
	writeFixture(t, filepath.Join(source, "outbox", "article-saved-r2.zip"), "fixture bundle bytes")
	writeFixture(t, filepath.Join(source, "unrelated", "skip"), "outside the migration contract")

	original, err := walkTree(ctx, source, sourceTrees, "")
	if err != nil {
		t.Fatal(err)
	}
	targets := privateFixtureDir(t)
	pkg := filepath.Join(targets, "package")
	first, err := prepare(ctx, source, pkg, noWriter)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Runs) != 4 || first.Jobs != 2 || len(first.Holds) != 3 || !slices.Equal(first.Backup, original) {
		t.Fatalf("unexpected migration counts: %d / %d / %d", len(first.Runs), first.Jobs, len(first.Holds))
	}
	repeat, err := prepare(ctx, source, pkg, noWriter)
	if err != nil || !reflect.DeepEqual(first, repeat) {
		t.Fatalf("package was not reused: %v", err)
	}
	if got := first.Holds[1]; got.JobID != parent || got.RemoteAgentID != "attached" ||
		got.RemoteEpoch != "timeline" || got.RemoteAfter != 11 || got.BoundaryTurnID != "earlier" {
		t.Fatal("legacy durable job and session identities differ")
	}
	if first.Holds[0].JobID != "" || first.Holds[2].Disposition != "job-record-missing" {
		t.Fatal("ambiguous and missing links were not distinguished")
	}
	after, err := walkTree(ctx, source, sourceTrees, "")
	if err != nil || !slices.Equal(after, original) {
		t.Fatalf("source was changed: %v", err)
	}
	verified, err := verify(ctx, pkg)
	if err != nil || !reflect.DeepEqual(first, verified) {
		t.Fatalf("package verification: %v", err)
	}

	local := privateFixtureDir(t)
	if _, err := walkTree(ctx, filepath.Join(pkg, "candidate"), nil, local); err != nil {
		t.Fatal(err)
	}
	db, err := store.Open(ctx, filepath.Join(local, "ai-runtime", "editorial.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	count := 0
	if err := db.ScanPending(ctx, func(contract.Intent) error { count++; return nil }); err != nil || count != 0 {
		t.Fatalf("migration created executable intents: %d / %v", count, err)
	}
	saved, err := db.GetRun(ctx, "saved")
	if err != nil || !bytes.Equal(saved.Value, []byte(savedRun)) || saved.Version != 12 {
		t.Fatalf("saved bytes differ: %v", err)
	}
	for _, id := range []string{"linked", "ambiguous", "missing"} {
		candidate, err := db.GetRun(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		var parsed struct {
			IssueKind string
			Pending   map[string]json.RawMessage
			State     struct{ Status, ResumeStatus string }
		}
		if err := json.Unmarshal(candidate.Value, &parsed); err != nil {
			t.Fatal(err)
		}
		if parsed.State.Status != "paused" || parsed.State.ResumeStatus == "" || parsed.IssueKind != "legacy_reconcile" || len(parsed.Pending) == 0 {
			t.Fatal("unconfirmed historical intent lost its hold")
		}
	}
	var cli bytes.Buffer
	if err := run(ctx, []string{"verify", "--package", pkg}, &cli); err != nil ||
		!strings.Contains(cli.String(), "4 runs, 2 legacy jobs, 3 held") || strings.Contains(cli.String(), "fixture-only") {
		t.Fatalf("CLI verification summary: %v", err)
	}
	restored := filepath.Join(targets, "restored")
	if err := run(ctx, []string{"restore", "--package", pkg, "--target", restored, "--before-go-writes"}, &cli); err != nil {
		t.Fatal(err)
	}
	if _, err := restore(ctx, pkg, restored); err != nil {
		t.Fatal(err)
	}
	restoredFiles, err := walkTree(ctx, restored, nil, "")
	if err != nil || !slices.Equal(restoredFiles, original) {
		t.Fatalf("restore bytes differ: %v", err)
	}
	tokenPath := filepath.Join(restored, "ai-runtime", "agent-token")
	if err := os.Chmod(tokenPath, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := restore(ctx, pkg, restored); err == nil {
		t.Fatal("accepted an existing restore target with a readable token")
	}
	if err := os.Chmod(tokenPath, 0o600); err != nil {
		t.Fatal(err)
	}
	writeFixture(t, filepath.Join(restored, "outbox", "article-saved-r2.zip"), "newer target")
	if _, err := restore(ctx, pkg, restored); err == nil {
		t.Fatal("overwrote a changed restore target")
	}

	writeFixture(t, filepath.Join(pkg, "manifest.json"), "{}")
	if _, err := verify(ctx, pkg); err == nil {
		t.Fatal("accepted a modified manifest")
	}
	if _, err := restore(ctx, pkg, filepath.Join(targets, "unverified")); err == nil {
		t.Fatal("restored unverified data")
	}
}

func TestConsistentOfflineWALSnapshot(t *testing.T) {
	ctx := t.Context()
	origin, db := legacyFixture(t, true)
	walSnapshot := privateFixtureDir(t)
	if _, err := walkTree(ctx, origin, sourceTrees, walSnapshot); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(walSnapshot, "ai-runtime", "editorial.sqlite-wal")); err != nil {
		t.Fatalf("synthetic WAL missing: %v", err)
	}
	closeFixture(t, db)
	pkg := filepath.Join(privateFixtureDir(t), "wal-package")
	report, err := prepare(ctx, walSnapshot, pkg, noWriter)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Runs) != 1 || report.Runs[0].ID != "saved" {
		t.Fatal("WAL-backed run was lost")
	}
	if !slices.ContainsFunc(report.Backup, func(item fileEntry) bool {
		return item.Path == "ai-runtime/editorial.sqlite-wal" && item.Size > 0
	}) {
		t.Fatal("original WAL was not in the backup")
	}
}

func TestPreflightPublishesNothingOnFailure(t *testing.T) {
	for _, scenario := range []string{"open-runtime", "active-job", "unreported-queued", "source-changed", "symlink"} {
		t.Run(scenario, func(t *testing.T) {
			ctx := t.Context()
			source, db := legacyFixture(t, false)
			probe := noWriter
			switch scenario {
			case "open-runtime":
				probe = func(context.Context, string) error { return errWriter }
			case "active-job":
				id := strings.Repeat("a", 64)
				writeFixture(t, filepath.Join(source, "ai-runtime", "jobs", id+".json"), `{"id":"`+id+`","status":"running"}`)
			case "unreported-queued":
				insert(t, db, "active", `{"state":{"status":"waiting_ai","revision":1,"version":1}}`)
			case "source-changed":
				var checks int
				probe = func(context.Context, string) error {
					checks++
					if checks == 2 {
						writeFixture(t, filepath.Join(source, "ai-runtime", "newer-state"), "newer")
					}
					return nil
				}
			case "symlink":
				external := filepath.Join(privateFixtureDir(t), "external")
				writeFixture(t, external, "outside")
				if err := os.Symlink(external, filepath.Join(source, "ai-runtime", "unexpected")); err != nil {
					t.Fatal(err)
				}
			}
			closeFixture(t, db)
			dest := privateFixtureDir(t)
			pkg := filepath.Join(dest, "incomplete")
			_, err := prepare(ctx, source, pkg, probe)
			switch scenario {
			case "open-runtime":
				if !errors.Is(err, errWriter) {
					t.Fatalf("runtime was not blocked: %v", err)
				}
			case "active-job", "unreported-queued":
				if !errors.Is(err, errActive) {
					t.Fatalf("active work was not blocked: %v", err)
				}
			case "source-changed":
				if err == nil || !strings.Contains(err.Error(), "changed") {
					t.Fatalf("source mutation was not blocked: %v", err)
				}
			case "symlink":
				if err == nil || !strings.Contains(err.Error(), "symbolic") {
					t.Fatalf("symlink was not blocked: %v", err)
				}
			}
			items, err := os.ReadDir(dest)
			if err != nil || len(items) != 0 {
				t.Fatalf("failed migration exposed files: %v / %v", items, err)
			}
		})
	}
}

func TestSyntheticProcessAndConfirmationGuards(t *testing.T) {
	proc, source := privateFixtureDir(t), privateFixtureDir(t)
	pid := filepath.Join(proc, "123", "fd")
	if err := os.MkdirAll(pid, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(source, "ai-runtime", "editorial.sqlite"), filepath.Join(pid, "7")); err != nil {
		t.Fatal(err)
	}
	if err := probeProc(t.Context(), proc, source, os.Geteuid(), 999); !errors.Is(err, errWriter) {
		t.Fatalf("an open legacy DB was not reported: %v", err)
	}
	if err := os.Remove(filepath.Join(pid, "7")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Dir(source), filepath.Join(proc, "123", "cwd")); err != nil {
		t.Fatal(err)
	}
	writeFixture(t, filepath.Join(proc, "123", "cmdline"), "node\x00automation/runtime/server.mjs\x00")
	if err := probeProc(t.Context(), proc, source, os.Geteuid(), 999); !errors.Is(err, errWriter) {
		t.Fatalf("an idle legacy bridge was not reported: %v", err)
	}
	for _, args := range [][]string{
		{"prepare", "--source", source, "--package", filepath.Join(privateFixtureDir(t), "untouched")},
		{"restore", "--package", source, "--target", filepath.Join(privateFixtureDir(t), "untouched")},
	} {
		if err := run(t.Context(), args, &bytes.Buffer{}); err == nil {
			t.Fatal("missing confirmation was accepted")
		}
	}
}
