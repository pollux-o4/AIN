package store

import (
	"context"
	"errors"
	"os"
)

// RequireRuntimeSchema prevents the standalone server from silently upgrading
// a legacy writer's database. The offline migration tool owns that operation.
func RequireRuntimeSchema(ctx context.Context, path string) error {
	return requireSchema(ctx, path, false)
}

// RequireExistingRuntimeSchema protects maintenance commands from creating or
// upgrading a database in a mistyped data directory.
func RequireExistingRuntimeSchema(ctx context.Context, path string) error {
	return requireSchema(ctx, path, true)
}

var errLegacySchema = errors.New("existing Go editorial schema required; migrate legacy data offline (MIG-053)")

func requireSchema(ctx context.Context, path string, existing bool) error {
	if _, err := os.Lstat(path); errors.Is(err, os.ErrNotExist) && !existing {
		return nil
	} else if err != nil {
		return err
	}
	if err := validateDatabaseFiles(path); err != nil {
		return err
	}
	db, err := OpenReadOnly(path)
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
	if !runs && !existing {
		return nil
	}
	if !runs || !migrated {
		return errLegacySchema
	}
	var version int
	if err := db.QueryRowContext(ctx, "SELECT COALESCE(MAX(version),0) FROM ain_schema_migrations").Scan(&version); err != nil {
		return err
	}
	var unresolved bool
	if err := db.QueryRowContext(ctx, `SELECT EXISTS(
		SELECT 1 FROM editorial_runs
		WHERE json_type(value, '$.pending') = 'object'
		AND COALESCE(json_extract(value, '$.issueKind'), '') <> 'legacy_reconcile'
	)`).Scan(&unresolved); err != nil {
		return err
	}
	if version < 1 || unresolved {
		return errLegacySchema
	}
	return nil
}
