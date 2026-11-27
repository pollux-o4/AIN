package contract

import (
	"context"
	"encoding/json"
)

// RemoteRef identifies a Paseo agent and, when known, the turn being watched.
type RemoteRef struct {
	AgentID string
	TurnID  string
	Epoch   string
	After   int64
}

type SessionSpec struct {
	Provider string
	Model    string
	Thinking string
	Mode     string
	WorkDir  string
	Prompt   string
	Labels   map[string]string
}

type Snapshot struct {
	Ref    RemoteRef
	Status string
	Body   json.RawMessage
}

// Paseo is the transport boundary. A successful cancellation request must be
// followed by a snapshot before recording that execution has stopped.
type Paseo interface {
	Probe(context.Context) (json.RawMessage, error)
	Create(context.Context, string, SessionSpec) (RemoteRef, error)
	Send(context.Context, RemoteRef, string) error
	Snapshot(context.Context, RemoteRef) (Snapshot, error)
	Watch(context.Context, RemoteRef, func(Snapshot) error) error
	Cancel(context.Context, RemoteRef) error
	Archive(context.Context, RemoteRef) error
}
