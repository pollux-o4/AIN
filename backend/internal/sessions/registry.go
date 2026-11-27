package sessions

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

type Key struct {
	ArticleID string
	Role      string
}

type Phase string

const (
	active    Phase = "active"
	warm      Phase = "warm"
	claimed   Phase = "claimed"
	sending   Phase = "sending"
	retired   Phase = "retired"
	archiving Phase = "archiving"
)

type Worker struct {
	Key        Key
	AgentID    string
	JobID      string
	OriginJob  string
	MessageID  string
	Provider   string
	Source     string
	Owner      string
	Phase      Phase
	ChangedAt  time.Time
	RetryAt    time.Time
	Attempts   int
	Boundary   Boundary
	Delivered  map[string]string
	Generation int64
}

type Registry struct {
	db *sql.DB
}

// NewRegistry installs the worker table in the editorial database. The caller
// owns the database and its connection lifecycle.
func NewRegistry(ctx context.Context, db *sql.DB) (*Registry, error) {
	if db == nil {
		return nil, errors.New("worker database is required")
	}
	_, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS ain_session_workers (
			agent_id TEXT PRIMARY KEY NOT NULL,
			generation INTEGER NOT NULL,
			article_id TEXT NOT NULL,
			role TEXT NOT NULL,
			phase TEXT NOT NULL,
			entry TEXT NOT NULL
		);
		CREATE UNIQUE INDEX IF NOT EXISTS ain_session_role_lease ON ain_session_workers(article_id, role)
			WHERE phase IN ('active', 'claimed', 'sending')
	`)
	if err != nil {
		return nil, err
	}
	return &Registry{db: db}, nil
}

func (r *Registry) get(ctx context.Context, id string) (Worker, error) {
	var raw []byte
	err := r.db.QueryRowContext(ctx, "SELECT entry FROM ain_session_workers WHERE agent_id = ?", id).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return Worker{}, contract.ErrNotFound
	}
	if err != nil {
		return Worker{}, err
	}
	return decodeWorker(raw)
}

func (r *Registry) List(ctx context.Context) ([]Worker, error) {
	rows, err := r.db.QueryContext(ctx, "SELECT entry FROM ain_session_workers")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Worker{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		entry, err := decodeWorker(raw)
		if err != nil {
			return nil, err
		}
		result = append(result, entry)
	}
	return result, rows.Err()
}

func (r *Registry) save(ctx context.Context, worker Worker) (Worker, error) {
	expected := worker.Generation
	worker.Generation++
	raw, err := json.Marshal(worker)
	if err != nil {
		return Worker{}, err
	}
	var result sql.Result
	if expected == 0 {
		result, err = r.db.ExecContext(ctx, `
			INSERT INTO ain_session_workers(agent_id,generation,article_id,role,phase,entry) VALUES (?,?,?,?,?,?)
			ON CONFLICT DO NOTHING`, worker.AgentID, worker.Generation, worker.Key.ArticleID, worker.Key.Role, worker.Phase, string(raw))
	} else {
		result, err = r.db.ExecContext(ctx, `
			UPDATE ain_session_workers SET generation=?,phase=?,entry=? WHERE agent_id=? AND generation=?`,
			worker.Generation, worker.Phase, string(raw), worker.AgentID, expected)
	}
	if err := changed(result, err); err != nil {
		return Worker{}, err
	}
	return worker, nil
}

func (r *Registry) remove(ctx context.Context, worker Worker) error {
	return changed(r.db.ExecContext(ctx, "DELETE FROM ain_session_workers WHERE agent_id=? AND generation=?",
		worker.AgentID, worker.Generation))
}

func changed(result sql.Result, err error) error {
	if err != nil {
		var sqliteErr *sqlite.Error
		if errors.As(err, &sqliteErr) && sqliteErr.Code() == sqlite3.SQLITE_CONSTRAINT_UNIQUE {
			return contract.ErrConflict
		}
		return err
	}
	count, err := result.RowsAffected()
	if err == nil && count != 1 {
		return contract.ErrConflict
	}
	return err
}

func decodeWorker(raw []byte) (Worker, error) {
	var worker Worker
	if json.Unmarshal(raw, &worker) != nil || worker.AgentID == "" || worker.Generation < 1 {
		return Worker{}, errors.New("invalid stored session worker")
	}
	return worker, nil
}
