package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

type SQLite struct {
	db         *sql.DB
	legacyRoot string
}

type Option func(*SQLite)

// WithLegacyPaseoRoot enables read-only access to previous job and worker files.
func WithLegacyPaseoRoot(path string) Option {
	return func(s *SQLite) { s.legacyRoot = path }
}

var _ contract.Store = (*SQLite)(nil)

// Open opens or creates a private file-backed editorial database.
func Open(ctx context.Context, path string, options ...Option) (*SQLite, error) {
	if path == "" {
		return nil, errors.New("editorial database path is required")
	}
	path, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	if err := prepareDatabase(path); err != nil {
		return nil, err
	}

	dsn := url.URL{Scheme: "file", Path: filepath.ToSlash(path)}
	dsn.RawQuery = "_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_txlock=immediate"
	db, err := sql.Open("sqlite", dsn.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &SQLite{db: db}
	for _, option := range options {
		option(s)
	}
	if err := s.migrate(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("prepare editorial schema: %w", err)
	}
	return s, nil
}

func (s *SQLite) Close() error {
	return s.db.Close()
}

func prepareDatabase(path string) error {
	parent := filepath.Dir(path)
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return err
	}
	info, err := os.Stat(parent)
	if err != nil {
		return err
	}
	if info.Mode().Perm()&0o022 != 0 {
		return errors.New("editorial database directory allows other users to write")
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	switch {
	case err == nil:
		if err := file.Close(); err != nil {
			return err
		}
	case !errors.Is(err, os.ErrExist):
		return err
	}
	for _, suffix := range []string{"", "-wal", "-shm", "-journal"} {
		info, err := os.Lstat(path + suffix)
		if suffix != "" && errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
			return errors.New("editorial database and sidecars must be private regular files")
		}
	}
	return nil
}

func (s *SQLite) write(ctx context.Context, change func(*sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := change(tx); err != nil {
		return err
	}
	return tx.Commit()
}

func constraintError(err error) error {
	var failure *sqlite.Error
	if errors.As(err, &failure) {
		switch failure.Code() {
		case sqlite3.SQLITE_CONSTRAINT_PRIMARYKEY, sqlite3.SQLITE_CONSTRAINT_UNIQUE:
			return contract.ErrConflict
		}
	}
	return err
}
