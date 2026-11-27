package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

const runVersion = `COALESCE(v.version,
	CASE WHEN json_type(r.value, '$.state.version') = 'integer'
		THEN json_extract(r.value, '$.state.version') ELSE 0 END)`

const readRun = `SELECT r.id, r.request_id, ` + runVersion + `, r.value
	FROM editorial_runs r LEFT JOIN ain_run_versions v ON v.run_id = r.id WHERE `

func (s *SQLite) GetRun(ctx context.Context, id string) (contract.Run, error) {
	return scanRun(s.db.QueryRowContext(ctx, readRun+"r.id = ?", id))
}

func (s *SQLite) FindRequest(ctx context.Context, requestID string) (contract.Run, error) {
	return scanRun(s.db.QueryRowContext(ctx, readRun+"r.request_id = ?", requestID))
}

func scanRun(row *sql.Row) (contract.Run, error) {
	var run contract.Run
	var value string
	err := row.Scan(&run.ID, &run.RequestID, &run.Version, &value)
	if errors.Is(err, sql.ErrNoRows) {
		return contract.Run{}, contract.ErrNotFound
	}
	run.Value = json.RawMessage(value)
	return run, err
}

func (s *SQLite) CreateRun(ctx context.Context, run contract.Run) error {
	if run.ID == "" || run.RequestID == "" || run.Version < 0 || !isObject(run.Value) {
		return errors.New("invalid editorial run")
	}
	return s.write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO editorial_runs(id, request_id, value)
			VALUES (?, ?, ?)`, run.ID, run.RequestID, string(run.Value)); err != nil {
			return constraintError(err)
		}
		return saveVersion(ctx, tx, run)
	})
}

func (s *SQLite) UpdateRun(ctx context.Context, expectedVersion int64, run contract.Run) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		return replaceRun(ctx, tx, expectedVersion, run)
	})
}

func replaceRun(ctx context.Context, tx *sql.Tx, expectedVersion int64, run contract.Run) error {
	if run.ID == "" || run.RequestID == "" || !isObject(run.Value) {
		return errors.New("invalid editorial run")
	}
	if run.Version <= expectedVersion {
		return contract.ErrConflict
	}
	var requestID string
	var version int64
	err := tx.QueryRowContext(ctx, `SELECT r.request_id, `+runVersion+`
		FROM editorial_runs r LEFT JOIN ain_run_versions v ON v.run_id = r.id WHERE r.id = ?`,
		run.ID).Scan(&requestID, &version)
	if errors.Is(err, sql.ErrNoRows) {
		return contract.ErrNotFound
	}
	if err != nil {
		return err
	}
	if version != expectedVersion || requestID != run.RequestID {
		return contract.ErrConflict
	}
	// Operation keys are scoped to a run, as in the legacy service. Keep the
	// signatures immutable so subsequent writes cannot erase replay evidence.
	result, err := tx.ExecContext(ctx, `
		UPDATE editorial_runs SET value = ? WHERE id = ? AND NOT EXISTS (
			SELECT 1 FROM json_each(editorial_runs.value, '$.operations') prior
			WHERE prior.key IS NOT NULL AND NOT EXISTS (
				SELECT 1 FROM json_each(?, '$.operations') proposed
				WHERE prior.key = proposed.key AND prior.type = proposed.type
					AND prior.value IS proposed.value
			)
		)`, string(run.Value), run.ID, string(run.Value))
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed == 0 {
		return contract.ErrConflict
	}
	return saveVersion(ctx, tx, run)
}

func saveVersion(ctx context.Context, tx *sql.Tx, run contract.Run) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO ain_run_versions(run_id, version)
		VALUES (?, ?) ON CONFLICT(run_id) DO UPDATE SET version = excluded.version`,
		run.ID, run.Version)
	return err
}

func isObject(data json.RawMessage) bool {
	for _, ch := range data {
		switch ch {
		case ' ', '\t', '\r', '\n':
			continue
		default:
			return ch == '{' && json.Valid(data)
		}
	}
	return false
}
