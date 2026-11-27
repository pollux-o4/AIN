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
		SELECT rowid, id,
			COALESCE(CAST(json_extract(value, '$.state.status') AS TEXT), ''),
			COALESCE(CAST(json_extract(value, '$.updatedAt') AS TEXT), ''),
			CASE WHEN json_type(value, '$.archivedAt') IN ('integer', 'real', 'text', 'true')
				AND json_extract(value, '$.archivedAt') NOT IN (0, '') THEN 1 ELSE 0 END
		FROM editorial_runs WHERE rowid > ? ORDER BY rowid LIMIT ?`,
		func(rows *sql.Rows) (int64, contract.RunSummary, error) {
			var sequence int64
			var summary contract.RunSummary
			err := rows.Scan(&sequence, &summary.ID, &summary.Status, &summary.UpdatedAt, &summary.Archived)
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
