package store

import (
	"context"
	"database/sql"
	"fmt"
)

// AIN owns this schema table. The Node store's table and PRAGMA user_version
// remain available to legacy readers.
var migrations = []string{`
	CREATE TABLE IF NOT EXISTS editorial_runs (
		id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, value TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS ain_run_versions (
		run_id TEXT PRIMARY KEY NOT NULL REFERENCES editorial_runs(id),
		version INTEGER NOT NULL
	);
	CREATE TABLE IF NOT EXISTS ain_intents (
		sequence INTEGER PRIMARY KEY AUTOINCREMENT,
		id TEXT NOT NULL UNIQUE,
		run_id TEXT NOT NULL REFERENCES editorial_runs(id),
		agent_id TEXT NOT NULL,
		action TEXT NOT NULL,
		deadline TEXT NOT NULL,
		remote_agent_id TEXT NOT NULL,
		remote_turn_id TEXT NOT NULL,
		remote_epoch TEXT NOT NULL,
		remote_after INTEGER NOT NULL,
		completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1))
	);
	CREATE UNIQUE INDEX IF NOT EXISTS ain_active_run_intent ON ain_intents(run_id) WHERE completed = 0;
	CREATE INDEX IF NOT EXISTS ain_pending_sequence ON ain_intents(sequence) WHERE completed = 0;
`}

func (s *SQLite) migrate(ctx context.Context) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `
			CREATE TABLE IF NOT EXISTS ain_schema_migrations (version INTEGER PRIMARY KEY)
		`); err != nil {
			return err
		}
		var version int
		if err := tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(version), 0) FROM ain_schema_migrations").Scan(&version); err != nil {
			return err
		}
		if version > len(migrations) {
			return fmt.Errorf("schema version %d is newer than supported version %d", version, len(migrations))
		}
		for index := version; index < len(migrations); index++ {
			if _, err := tx.ExecContext(ctx, migrations[index]); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, "INSERT INTO ain_schema_migrations VALUES (?)", index+1); err != nil {
				return err
			}
		}
		return nil
	})
}
