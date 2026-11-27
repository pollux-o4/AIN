package store

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

// LegacyJob is the read-only link from an editorial job ID to its remote agent.
// BoundaryTurnID is the turn preceding a reused job, if present.
type LegacyJob struct {
	ID             string
	Status         string
	ParentID       string
	Parts          []string
	Deadline       time.Time
	Remote         contract.RemoteRef
	BoundaryTurnID string
	Value          json.RawMessage
}

type LegacyPending struct {
	RunID string
	JobID string
	Body  json.RawMessage
	Job   *LegacyJob
}

type LegacyWorker struct {
	AgentID   string          `json:"agentId"`
	Delivered json.RawMessage `json:"delivered"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

func (s *SQLite) LegacyJob(ctx context.Context, id string) (LegacyJob, error) {
	if _, err := hex.DecodeString(id); err != nil || len(id) != sha256.Size*2 || id != strings.ToLower(id) {
		return LegacyJob{}, errors.New("invalid legacy job ID")
	}
	raw, err := s.readLegacy(ctx, id+".json")
	if err != nil {
		return LegacyJob{}, err
	}
	var record struct {
		ID       string
		AgentID  string
		Status   string
		ParentID string
		Parts    []string
		Deadline int64
		Boundary struct {
			Epoch  string
			Seq    int64
			TurnID string
		} `json:"workerBoundary"`
	}
	if json.Unmarshal(raw, &record) != nil || record.ID != id {
		return LegacyJob{}, errors.New("invalid legacy job record")
	}
	job := LegacyJob{
		ID: id, Status: record.Status, ParentID: record.ParentID, Parts: record.Parts,
		Remote:         contract.RemoteRef{AgentID: record.AgentID, Epoch: record.Boundary.Epoch, After: record.Boundary.Seq},
		BoundaryTurnID: record.Boundary.TurnID,
		Value:          raw,
	}
	if record.Deadline != 0 {
		job.Deadline = time.UnixMilli(record.Deadline).UTC()
	}
	return job, nil
}

// ScanLegacyPending projects legacy queue records separately. A nil Job means
// the saved intent has no confirmed local job link and requires reconciliation.
func (s *SQLite) ScanLegacyPending(ctx context.Context, visit func(LegacyPending) error) error {
	return scanPages(ctx, s.db, `
		SELECT rowid, id, COALESCE(json_extract(value, '$.pending.jobId'), ''),
			COALESCE(json_extract(value, '$.pending.body'), '')
		FROM editorial_runs
		WHERE rowid > ? AND json_type(value, '$.pending') = 'object'
		ORDER BY rowid LIMIT ?`,
		func(rows *sql.Rows) (int64, LegacyPending, error) {
			var sequence int64
			var pending LegacyPending
			var body string
			err := rows.Scan(&sequence, &pending.RunID, &pending.JobID, &body)
			pending.Body = json.RawMessage(body)
			return sequence, pending, err
		},
		func(pending LegacyPending) error {
			jobID := pending.JobID
			if jobID == "" && len(pending.Body) != 0 {
				var compact bytes.Buffer
				if err := json.Compact(&compact, pending.Body); err != nil {
					return errors.New("invalid legacy reserved job body")
				}
				// Matches legacy JobStore.find, including its JSON key order.
				jobID = digest(compact.Bytes())
			}
			if jobID != "" {
				job, err := s.LegacyJob(ctx, jobID)
				if err != nil && !errors.Is(err, contract.ErrNotFound) {
					return err
				}
				if err == nil {
					pending.JobID, pending.Job = job.ID, &job
				}
			}
			return visit(pending)
		},
	)
}

func (s *SQLite) LegacyWorkers(ctx context.Context, articleID string) (map[string]LegacyWorker, error) {
	raw, err := s.readLegacy(ctx, filepath.Join("workers", digest([]byte(articleID))+".json"))
	if err != nil {
		return nil, err
	}
	var workers map[string]LegacyWorker
	if json.Unmarshal(raw, &workers) != nil || workers == nil {
		return nil, errors.New("invalid legacy worker record")
	}
	return workers, nil
}

func digest(raw []byte) string {
	return fmt.Sprintf("%x", sha256.Sum256(raw))
}

func (s *SQLite) readLegacy(ctx context.Context, name string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s.legacyRoot == "" {
		return nil, contract.ErrNotFound
	}
	root, err := os.OpenRoot(s.legacyRoot)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, contract.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	defer root.Close()
	raw, err := root.ReadFile(name)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, contract.ErrNotFound
	}
	return raw, err
}
