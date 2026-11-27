package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

const pageSize = 32

func (s *SQLite) ListSummaries(ctx context.Context, visit func(contract.RunSummary) error) error {
	return scanPages(ctx, s.db, `
		SELECT sequence, id, status, idea, revision, updated_at, archived, title, monitor, COALESCE(needs_completion, 0)
		FROM ain_run_summaries WHERE sequence > ? ORDER BY sequence LIMIT ?`,
		func(rows *sql.Rows) (int64, contract.RunSummary, error) {
			var sequence int64
			var summary contract.RunSummary
			err := rows.Scan(&sequence, &summary.ID, &summary.Status, &summary.Idea, &summary.Revision, &summary.UpdatedAt, &summary.Archived, &summary.Title, &summary.Monitor, &summary.NeedsCompletion)
			return sequence, summary, err
		},
		visit,
	)
}

func (s *SQLite) ScanPending(ctx context.Context, visit func(contract.Intent) error) error {
	return scanPages(ctx, s.db, `
		SELECT sequence, id, run_id, agent_id, action, deadline,
			remote_agent_id, remote_turn_id, remote_epoch, remote_after
		FROM ain_intents WHERE completed = 0 AND sequence > ? ORDER BY sequence LIMIT ?`,
		func(rows *sql.Rows) (int64, contract.Intent, error) {
			var sequence int64
			var intent contract.Intent
			var action, deadline string
			err := rows.Scan(&sequence, &intent.ID, &intent.RunID, &intent.AgentID, &action, &deadline,
				&intent.Remote.AgentID, &intent.Remote.TurnID, &intent.Remote.Epoch, &intent.Remote.After)
			if err == nil {
				intent.Action = json.RawMessage(action)
				intent.Deadline, err = time.Parse(time.RFC3339Nano, deadline)
			}
			return sequence, intent, err
		},
		visit,
	)
}

// Release the SQLite connection before calling visitors. A visitor may write
// results or perform remote I/O while processing an item.
func scanPages[T any](ctx context.Context, db *sql.DB, query string, read func(*sql.Rows) (int64, T, error), visit func(T) error) error {
	var after int64
	for {
		rows, err := db.QueryContext(ctx, query, after, pageSize)
		if err != nil {
			return err
		}
		page := make([]T, 0, pageSize)
		for rows.Next() {
			next, item, err := read(rows)
			if err != nil {
				rows.Close()
				return err
			}
			after = next
			page = append(page, item)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		for _, item := range page {
			if err := ctx.Err(); err != nil {
				return err
			}
			if err := visit(item); err != nil {
				return err
			}
		}
		if len(page) < pageSize {
			return nil
		}
	}
}

// PendingRun uses the active run index to locate a single observation target.
func (s *SQLite) PendingRun(ctx context.Context, id string) (contract.Intent, error) {
	var intent contract.Intent
	var action, deadline string
	err := s.db.QueryRowContext(ctx, `
		SELECT id, run_id, agent_id, action, deadline,
			remote_agent_id, remote_turn_id, remote_epoch, remote_after
		FROM ain_intents WHERE run_id = ? AND completed = 0`, id).
		Scan(&intent.ID, &intent.RunID, &intent.AgentID, &action, &deadline,
			&intent.Remote.AgentID, &intent.Remote.TurnID, &intent.Remote.Epoch, &intent.Remote.After)
	if err == sql.ErrNoRows {
		return contract.Intent{}, contract.ErrNotFound
	}
	if err != nil {
		return contract.Intent{}, err
	}
	intent.Action = json.RawMessage(action)
	intent.Deadline, err = time.Parse(time.RFC3339Nano, deadline)
	return intent, err
}

// PendingRunObservation reads the binding used by monitor labels without
// loading the stored action or its previous figure data.
func (s *SQLite) PendingRunObservation(ctx context.Context, id string) (contract.Intent, error) {
	var intent contract.Intent
	err := s.db.QueryRowContext(ctx, `
		SELECT remote_agent_id, remote_turn_id
		FROM ain_intents WHERE run_id = ? AND completed = 0`, id).
		Scan(&intent.Remote.AgentID, &intent.Remote.TurnID)
	if err == sql.ErrNoRows {
		return contract.Intent{}, contract.ErrNotFound
	}
	return intent, err
}
