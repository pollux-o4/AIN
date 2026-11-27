package runtime

import (
	"context"
	"database/sql"
	"errors"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/runner"
	"github.com/pollux-o4/AIN/backend/internal/sessions"
	"github.com/pollux-o4/AIN/backend/internal/writingai"
)

var _ runner.SessionTurns = Turns{}

type trackedWriting interface {
	BuildTrackedTurn(contract.Run, contract.Action) (contract.SessionSpec, map[string]string, error)
	BuildReuseTurn(contract.Run, contract.Action, map[string]string) (contract.SessionSpec, map[string]string, error)
}

// NewSessionManager attaches the durable role registry to the caller's
// protected database. Assign it to EditorialConfig.Runner.Sessions before
// building the runtime.
func NewSessionManager(ctx context.Context, db *sql.DB, wire sessions.Wire, cfg sessions.Config) (*sessions.Manager, error) {
	registry, err := sessions.NewRegistry(ctx, db)
	if err != nil {
		return nil, err
	}
	return sessions.New(registry, wire, cfg)
}

func (t Turns) SessionRole(action contract.Action) (string, bool) {
	role := writingai.Role(action)
	if role == "" {
		return "", false
	}
	_, reusable := t.Writing.(trackedWriting)
	return role, reusable
}

func (t Turns) BuildTrackedTurn(run contract.Run, action contract.Action) (contract.SessionSpec, map[string]string, error) {
	if _, reuse := t.SessionRole(action); reuse {
		return t.Writing.(trackedWriting).BuildTrackedTurn(run, action)
	}
	spec, err := t.BuildTurn(run, action)
	return spec, nil, err
}

func (t Turns) BuildReuseTurn(run contract.Run, action contract.Action, delivered map[string]string) (contract.SessionSpec, map[string]string, error) {
	if _, reuse := t.SessionRole(action); !reuse {
		return contract.SessionSpec{}, nil, errors.New("editorial action does not reuse a working session")
	}
	return t.Writing.(trackedWriting).BuildReuseTurn(run, action, delivered)
}
