package contract

import (
	"context"
	"encoding/json"
)

// Action describes a next transition. Kind is empty when the run is waiting
// for a person's decision or has reached a terminal state.
type Action struct {
	Kind     string
	Stage    string
	FigureID string
	Input    json.RawMessage
}

type Event struct {
	ID    string
	Actor string
	Kind  string
	Body  json.RawMessage
}

// EditorialRules computes transitions without performing external I/O.
type EditorialRules interface {
	Next(Run) (Action, error)
	Reduce(Run, Event) (Run, error)
}

type TurnBuilder interface {
	BuildTurn(Run, Action) (SessionSpec, error)
	ValidateResult(Action, Snapshot) (Event, error)
}

// Scheduler is independent of the lifetime of an HTTP request or SSE client.
type Scheduler interface {
	Wake(runID string)
	Pause(context.Context, string) error
	Recover(context.Context) error
}
