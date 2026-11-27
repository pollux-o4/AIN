package store

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"os"
	"path/filepath"
)

// RequireRuntimeSchema prevents the standalone server from silently upgrading
// a legacy writer's database. The offline migration tool owns that operation.
func RequireRuntimeSchema(ctx context.Context, path string) error {
	if _, err := os.Lstat(path); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	if err := validateDatabaseFiles(path); err != nil {
		return err
	}
	dsn := url.URL{Scheme: "file", Path: filepath.ToSlash(path), RawQuery: "mode=ro"}
	db, err := sql.Open("sqlite", dsn.String())
	if err != nil {
		return err
	}
	defer db.Close()
	var runs, migrated bool
	if err := db.QueryRowContext(ctx, `SELECT
		EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='editorial_runs'),
		EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='ain_schema_migrations')`).Scan(&runs, &migrated); err != nil {
		return err
	}
	if !runs {
		return nil
	}
	legacy := !migrated
	if migrated {
		err := db.QueryRowContext(ctx, `SELECT EXISTS(
			SELECT 1 FROM editorial_runs
			WHERE json_type(value, '$.pending') = 'object'
			AND COALESCE(json_extract(value, '$.issueKind'), '') <> 'legacy_reconcile'
		)`).Scan(&legacy)
		if err != nil {
			return err
		}
	}
	if legacy {
		return errors.New("legacy editorial database requires verified offline migration (MIG-053)")
	}
	return nil
}
