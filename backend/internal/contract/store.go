package contract

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

var (
	ErrConflict          = errors.New("version conflict")
	ErrNotFound          = errors.New("record not found")
	ErrDeliveryUncertain = errors.New("remote delivery could not be confirmed")
)

// Run preserves the serialized editorial record across backend versions.
type Run struct {
	ID        string
	RequestID string
	Version   int64
	Value     json.RawMessage
}

// Intent is persisted before any remote side effect. Its identity survives retries.
type Intent struct {
	ID       string
	RunID    string
	AgentID  string
	Action   json.RawMessage
	Deadline time.Time
	Remote   RemoteRef
}

type RunSummary struct {
	ID        string
	Status    string
	Idea      string
	Revision  int64
	UpdatedAt string
	Archived  bool
}

type Store interface {
	GetRun(context.Context, string) (Run, error)
	FindRequest(context.Context, string) (Run, error)
	ListSummaries(context.Context, func(RunSummary) error) error
	ScanPending(context.Context, func(Intent) error) error
	CreateRun(context.Context, Run) error
	UpdateRun(context.Context, int64, Run) error
	Reserve(context.Context, int64, Run, Intent) error
	Bind(context.Context, string, RemoteRef) error
	Commit(context.Context, int64, string, Run) error
}
