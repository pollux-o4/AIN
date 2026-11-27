package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

func (s *SQLite) Reserve(ctx context.Context, expectedVersion int64, run contract.Run, intent contract.Intent) error {
	if intent.ID == "" || intent.RunID != run.ID || !json.Valid(intent.Action) || intent.Remote.After < 0 {
		return errors.New("invalid execution intent")
	}
	return s.write(ctx, func(tx *sql.Tx) error {
		// The proposed run includes the budget consumed by the reservation.
		if err := replaceRun(ctx, tx, expectedVersion, run); err != nil {
			return err
		}
		ref := intent.Remote
		_, err := tx.ExecContext(ctx, `
			INSERT INTO ain_intents
			(id, run_id, agent_id, action, deadline, remote_agent_id, remote_turn_id, remote_epoch, remote_after)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			intent.ID, intent.RunID, intent.AgentID, string(intent.Action),
			intent.Deadline.Format(time.RFC3339Nano), ref.AgentID, ref.TurnID, ref.Epoch, ref.After)
		return constraintError(err)
	})
}

func (s *SQLite) Bind(ctx context.Context, intentID string, remote contract.RemoteRef) error {
	if remote.AgentID == "" || remote.After < 0 {
		return errors.New("invalid remote reference")
	}
	return s.write(ctx, func(tx *sql.Tx) error {
		var saved contract.RemoteRef
		var complete bool
		err := tx.QueryRowContext(ctx, `
			SELECT remote_agent_id, remote_turn_id, remote_epoch, remote_after, completed
			FROM ain_intents WHERE id = ?`, intentID).Scan(
			&saved.AgentID, &saved.TurnID, &saved.Epoch, &saved.After, &complete)
		if errors.Is(err, sql.ErrNoRows) {
			return contract.ErrNotFound
		}
		if err != nil {
			return err
		}
		if complete || differs(saved.AgentID, remote.AgentID) ||
			differs(saved.TurnID, remote.TurnID) || differs(saved.Epoch, remote.Epoch) {
			return contract.ErrConflict
		}
		if remote.TurnID == "" {
			remote.TurnID = saved.TurnID
		}
		if remote.Epoch == "" {
			remote.Epoch = saved.Epoch
		}
		_, err = tx.ExecContext(ctx, `
			UPDATE ain_intents SET remote_agent_id = ?, remote_turn_id = ?, remote_epoch = ?, remote_after = ?
			WHERE id = ?`, remote.AgentID, remote.TurnID, remote.Epoch, max(saved.After, remote.After), intentID)
		return err
	})
}

func differs(saved, next string) bool {
	return saved != "" && next != "" && saved != next
}

func (s *SQLite) Commit(ctx context.Context, expectedVersion int64, intentID string, run contract.Run) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		var owner string
		var complete bool
		err := tx.QueryRowContext(ctx, "SELECT run_id, completed FROM ain_intents WHERE id = ?", intentID).
			Scan(&owner, &complete)
		if errors.Is(err, sql.ErrNoRows) {
			return contract.ErrNotFound
		}
		if err != nil {
			return err
		}
		if owner != run.ID || complete {
			return contract.ErrConflict
		}
		if err := replaceRun(ctx, tx, expectedVersion, run); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, "UPDATE ain_intents SET completed = 1 WHERE id = ?", intentID)
		return err
	})
}
