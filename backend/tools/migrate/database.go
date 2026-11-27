package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/store"
)

var (
	jobName      = regexp.MustCompile(`^[0-9a-f]{64}\.json$`)
	errActive    = errors.New("active legacy work remains; finish or safely reconcile it before migration")
	activeStates = []string{"waiting_ai", "waiting_route", "waiting_figure"}
)

type runEntry struct {
	ID        string `json:"id"`
	RequestID string `json:"requestId"`
	Before    string `json:"before"`
	After     string `json:"after"`
	Status    string `json:"status"`
	Revision  int64  `json:"revision"`
}
type hold struct {
	RunID          string `json:"runId"`
	JobID          string `json:"jobId,omitempty"`
	Disposition    string `json:"disposition"`
	RemoteAgentID  string `json:"remoteAgentId,omitempty"`
	BoundaryTurnID string `json:"boundaryTurnId,omitempty"`
	RemoteEpoch    string `json:"remoteEpoch,omitempty"`
	RemoteAfter    int64  `json:"remoteAfter,omitempty"`
}

func openRead(path string) (*sql.DB, error) {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return nil, errors.New("editorial.sqlite is not a regular file")
	}
	dsn := url.URL{Scheme: "file", Path: filepath.ToSlash(path), RawQuery: "mode=ro&_pragma=query_only(1)"}
	db, err := sql.Open("sqlite", dsn.String())
	if err == nil {
		db.SetMaxOpenConns(1)
	}
	return db, err
}

func checkSQLite(ctx context.Context, db *sql.DB, mustBeLegacy bool) error {
	var integrity string
	if err := db.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&integrity); err != nil || integrity != "ok" {
		return errors.New("SQLite integrity check failed")
	}
	var migrated bool
	if err := db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='ain_schema_migrations')").Scan(&migrated); err != nil {
		return err
	}
	if mustBeLegacy == migrated {
		return errors.New("database schema does not match the requested migration phase")
	}
	if migrated {
		rows, err := db.QueryContext(ctx, "PRAGMA foreign_key_check")
		if err != nil {
			return err
		}
		defer rows.Close()
		if rows.Next() {
			return errors.New("candidate SQLite foreign key check failed")
		}
		return rows.Err()
	}
	return nil
}

func scanRuns(ctx context.Context, path string, visit func(contract.Run) error) error {
	db, err := openRead(path)
	if err != nil {
		return err
	}
	defer db.Close()
	rows, err := db.QueryContext(ctx, "SELECT id, request_id, value FROM editorial_runs ORDER BY id")
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var run contract.Run
		var value string
		if err := rows.Scan(&run.ID, &run.RequestID, &value); err != nil {
			return err
		}
		run.Value = json.RawMessage(value)
		if err := visit(run); err != nil {
			return err
		}
	}
	return rows.Err()
}

func readJobs(ctx context.Context, jobsRoot string, db *store.SQLite) (map[string]store.LegacyJob, error) {
	files, err := os.ReadDir(jobsRoot)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	jobs := make(map[string]store.LegacyJob)
	for _, file := range files {
		if !jobName.MatchString(file.Name()) {
			continue
		}
		if !file.Type().IsRegular() {
			return nil, errors.New("legacy job is not a regular file")
		}
		id := strings.TrimSuffix(file.Name(), ".json")
		job, err := db.LegacyJob(ctx, id)
		if err != nil {
			return nil, err
		}
		if job.Status != "completed" && job.Status != "failed" {
			return nil, errActive
		}
		job.Value = nil // hash inventory verifies the full saved result separately
		jobs[id] = job
	}
	for id, job := range jobs {
		if job.ParentID != "" {
			if len(job.Parts) != 0 {
				return nil, errors.New("legacy job batch is nested or cyclic")
			}
			parent, exists := jobs[job.ParentID]
			if !exists || !slices.Contains(parent.Parts, id) {
				return nil, errors.New("legacy job batch parent is inconsistent")
			}
		}
		seen := map[string]bool{}
		for _, part := range job.Parts {
			child, exists := jobs[part]
			if !exists || child.ParentID != id || part == id || seen[part] {
				return nil, errors.New("legacy job batch child is inconsistent")
			}
			seen[part] = true
		}
	}
	return jobs, nil
}

type inspectedRun struct {
	state    map[string]json.RawMessage
	record   map[string]json.RawMessage
	status   string
	revision int64
	version  int64
	issue    string
	pending  *struct{ JobID string }
}

func inspectRun(run contract.Run) (inspectedRun, error) {
	var result inspectedRun
	var fields struct {
		ID        string
		RequestID string
		Issue     string
		Pending   *struct{ JobID string }
		State     struct {
			ArticleID string
			Status    string
			Revision  int64
			Version   int64
		}
	}
	if err := json.Unmarshal(run.Value, &fields); err != nil {
		return result, errors.New("invalid legacy run record")
	}
	if run.ID == "" || run.RequestID == "" || fields.State.Status == "" ||
		fields.State.Revision < 1 || fields.State.Version < 1 ||
		(fields.ID != "" && fields.ID != run.ID) || (fields.RequestID != "" && fields.RequestID != run.RequestID) ||
		(fields.State.ArticleID != "" && fields.State.ArticleID != run.ID) {
		return result, errors.New("legacy run identity, status, or revision is inconsistent")
	}
	if err := json.Unmarshal(run.Value, &result.record); err != nil {
		return result, errors.New("invalid legacy run object")
	}
	if err := json.Unmarshal(result.record["state"], &result.state); err != nil || result.state == nil {
		return result, errors.New("invalid legacy state object")
	}
	result.status, result.revision, result.version = fields.State.Status, fields.State.Revision, fields.State.Version
	result.issue, result.pending = fields.Issue, fields.Pending
	return result, nil
}

func reconcile(run contract.Run, saved inspectedRun, jobs map[string]store.LegacyJob) (contract.Run, *hold, error) {
	pending := slices.Contains(activeStates, saved.status)
	switch {
	case saved.pending == nil && !pending:
		return run, nil, nil
	case saved.pending == nil && saved.issue == "":
		return contract.Run{}, nil, errActive
	}
	if !pending && saved.status != "paused" && saved.status != "failed" {
		return contract.Run{}, nil, errors.New("an inactive run has unresolved delivery metadata")
	}
	item := hold{RunID: run.ID, Disposition: "delivery-unconfirmed"}
	if saved.pending != nil && saved.pending.JobID != "" {
		item.JobID = saved.pending.JobID
		if !jobName.MatchString(item.JobID + ".json") {
			return contract.Run{}, nil, errors.New("invalid persisted job identifier")
		}
		if linked, exists := jobs[item.JobID]; exists {
			item.RemoteAgentID, item.BoundaryTurnID = linked.Remote.AgentID, linked.BoundaryTurnID
			item.RemoteEpoch, item.RemoteAfter = linked.Remote.Epoch, linked.Remote.After
			item.Disposition = "terminal-result-needs-review"
		} else {
			item.Disposition = "job-record-missing"
		}
	}
	if pending {
		saved.state["resumeStatus"] = saved.state["status"]
		saved.state["status"] = json.RawMessage(`"paused"`)
	}
	saved.record["issue"] = json.RawMessage(`"이전 편집 서비스의 원격 작업 상태를 확인해야 합니다."`)
	saved.record["issueKind"] = json.RawMessage(`"legacy_reconcile"`)
	var err error
	saved.record["state"], err = json.Marshal(saved.state)
	if err != nil {
		return contract.Run{}, nil, err
	}
	run.Value, err = json.Marshal(saved.record)
	run.Version = saved.version + 1
	return run, &item, err
}

func applySchema(ctx context.Context, root string) ([]runEntry, []hold, int, error) {
	runtime := filepath.Join(root, "ai-runtime")
	path, jobsRoot := filepath.Join(runtime, "editorial.sqlite"), filepath.Join(runtime, "jobs")
	prior, err := openRead(path)
	if err != nil {
		return nil, nil, 0, err
	}
	err = errors.Join(checkSQLite(ctx, prior, true), prior.Close())
	if err != nil {
		return nil, nil, 0, err
	}
	db, err := store.Open(ctx, path, store.WithLegacyPaseoRoot(jobsRoot))
	if err != nil {
		return nil, nil, 0, err
	}
	defer db.Close()
	jobs, err := readJobs(ctx, jobsRoot, db)
	if err != nil {
		return nil, nil, 0, err
	}

	var entries []runEntry
	var holds []hold
	err = scanRuns(ctx, path, func(run contract.Run) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		saved, err := inspectRun(run)
		if err != nil {
			return err
		}
		candidate, held, err := reconcile(run, saved, jobs)
		if err != nil {
			return err
		}
		if held != nil {
			if err := db.UpdateRun(ctx, saved.version, candidate); err != nil {
				return err
			}
			holds = append(holds, *held)
		}
		entries = append(entries, runEntry{
			ID: run.ID, RequestID: run.RequestID,
			Before: digest(run.Value), After: digest(candidate.Value),
			Status: saved.status, Revision: saved.revision,
		})
		return nil
	})
	if err != nil {
		return nil, nil, 0, err
	}
	expected := make(map[string]runEntry, len(entries))
	for _, entry := range entries {
		expected[entry.ID] = entry
	}
	err = scanRuns(ctx, path, func(run contract.Run) error {
		entry, exists := expected[run.ID]
		if !exists || entry.RequestID != run.RequestID || entry.After != digest(run.Value) {
			return errors.New("candidate editorial record failed the byte verification")
		}
		delete(expected, run.ID)
		return nil
	})
	if err != nil || len(expected) != 0 {
		return nil, nil, 0, errors.Join(err, errors.New("candidate run inventory is incomplete"))
	}
	checked, err := openRead(path)
	if err != nil {
		return nil, nil, 0, err
	}
	if err := errors.Join(checkSQLite(ctx, checked, false), checked.Close(), db.Close()); err != nil {
		return nil, nil, 0, err
	}
	return entries, holds, len(jobs), nil
}

func digest(value []byte) string { return fmt.Sprintf("%x", sha256.Sum256(value)) }
