package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/figuredomain"
	"github.com/pollux-o4/AIN/backend/internal/writing"
)

var summaryRules = writing.NewWithFigures(figuredomain.New())

// Node-compatible triggers mark changed metadata dirty without needing a Go
// SQLite function. Validate the condition using the writing rules before the
// Go write becomes visible, or at open after the legacy writer stopped.
// Load one dirty record at a time, never the full history set into memory.
func validateSummaries(ctx context.Context, tx *sql.Tx) error {
	for {
		var sequence int64
		var raw string
		err := tx.QueryRowContext(ctx, `
			SELECT s.sequence,r.value
			FROM ain_run_summaries AS s
			JOIN editorial_runs AS r ON r.rowid=s.sequence
			WHERE s.needs_completion IS NULL AND s.archived=0 AND s.monitor <> ''
			ORDER BY s.sequence LIMIT 1`).Scan(&sequence, &raw)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		action, err := summaryRules.Next(contract.Run{Value: []byte(raw)})
		var next struct{ Type string }
		needsCompletion := err != nil || (json.Unmarshal(action.Input, &next) == nil && next.Type == "requirements_required")
		if _, err := tx.ExecContext(ctx, `UPDATE ain_run_summaries SET needs_completion=? WHERE sequence=?`, needsCompletion, sequence); err != nil {
			return err
		}
	}
}
