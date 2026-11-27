package store

import (
	"database/sql"
	"errors"
	"net/url"
	"os"
	"path/filepath"
)

// OpenReadOnly opens a regular SQLite file without creating a database.
// Callers remain responsible for locking the data root and authorizing access.
func OpenReadOnly(path string) (*sql.DB, error) {
	path, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("editorial database must be a regular file")
	}
	dsn := url.URL{Scheme: "file", Path: filepath.ToSlash(path), RawQuery: "mode=ro&_pragma=query_only(1)"}
	db, err := sql.Open("sqlite", dsn.String())
	if err == nil {
		db.SetMaxOpenConns(1)
	}
	return db, err
}
