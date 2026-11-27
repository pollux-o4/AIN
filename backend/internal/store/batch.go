package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

const activeRemoteTurns = `SELECT
	(SELECT COUNT(*) FROM ain_intents WHERE completed = 0 AND agent_id <> '') +
	(SELECT COUNT(*) FROM ain_batch_children WHERE state = 1)`

func (s *SQLite) ReserveWithinLimit(ctx context.Context, version int64, run contract.Run, intent contract.Intent, limit int) (bool, error) {
	var reserved bool
	err := s.write(ctx, func(tx *sql.Tx) error {
		free, err := availableTurn(ctx, tx, limit)
		if err != nil || !free {
			return err
		}
		if err := insertIntent(ctx, tx, version, run, intent); err != nil {
			return err
		}
		reserved = true
		return nil
	})
	return reserved && err == nil, err
}

func availableTurn(ctx context.Context, tx *sql.Tx, limit int) (bool, error) {
	if limit < 1 {
		return false, errors.New("invalid remote execution limit")
	}
	var taken int
	err := tx.QueryRowContext(ctx, activeRemoteTurns).Scan(&taken)
	return taken < limit, err
}

func (s *SQLite) ReserveBatch(ctx context.Context, version int64, run contract.Run, parent contract.Intent, children []contract.Intent) error {
	if parent.AgentID != "" || len(children) == 0 || len(children) > 30 {
		return errors.New("invalid figure batch reservation")
	}
	return s.write(ctx, func(tx *sql.Tx) error {
		if err := insertIntent(ctx, tx, version, run, parent); err != nil {
			return err
		}
		for position, child := range children {
			if child.ID == "" || child.ID == parent.ID || child.AgentID == "" ||
				child.RunID != run.ID || !json.Valid(child.Action) || child.Remote != (contract.RemoteRef{}) {
				return errors.New("invalid figure child reservation")
			}
			_, err := tx.ExecContext(ctx, `INSERT INTO ain_batch_children
				(position,id,parent_id,agent_id,action,deadline) VALUES (?,?,?,?,?,?)`,
				position, child.ID, parent.ID, child.AgentID, string(child.Action), child.Deadline.Format(time.RFC3339Nano))
			if err != nil {
				return constraintError(err)
			}
		}
		return nil
	})
}

func (s *SQLite) BatchChildren(ctx context.Context, parentID string) ([]contract.BatchChild, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT child.id,p.run_id,child.agent_id,child.action,child.deadline,
			child.remote_agent_id,child.remote_turn_id,child.remote_epoch,child.remote_after,
			child.state,child.result,child.failure
		FROM ain_batch_children child JOIN ain_intents p ON child.parent_id=p.id
		WHERE p.id=? AND p.completed=0 ORDER BY child.position`, parentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	children := []contract.BatchChild{}
	for rows.Next() {
		var child contract.BatchChild
		var action, deadline string
		var state int
		var result sql.NullString
		if err := rows.Scan(&child.ID, &child.RunID, &child.AgentID, &action, &deadline,
			&child.Remote.AgentID, &child.Remote.TurnID, &child.Remote.Epoch, &child.Remote.After,
			&state, &result, &child.Failure); err != nil {
			return nil, err
		}
		child.Action = json.RawMessage(action)
		child.Deadline, err = time.Parse(time.RFC3339Nano, deadline)
		if err != nil {
			return nil, err
		}
		child.Started = state == 1 || (state == 2 && child.Remote.AgentID != "")
		if result.Valid {
			child.Result = new(contract.Event)
			if err := json.Unmarshal([]byte(result.String), child.Result); err != nil {
				return nil, err
			}
		}
		children = append(children, child)
	}
	return children, rows.Err()
}

func (s *SQLite) ClaimBatchChild(ctx context.Context, id string, limit int) (bool, error) {
	var claimed bool
	err := s.write(ctx, func(tx *sql.Tx) error {
		free, err := availableTurn(ctx, tx, limit)
		if err != nil || !free {
			return err
		}
		result, err := tx.ExecContext(ctx, `UPDATE ain_batch_children SET state=1 WHERE id=? AND state=0
			AND EXISTS (SELECT 1 FROM ain_intents WHERE id=parent_id AND completed=0)`, id)
		if err != nil {
			return err
		}
		changed, err := result.RowsAffected()
		claimed = changed == 1
		return err
	})
	return claimed && err == nil, err
}

func (s *SQLite) FinishBatchChild(ctx context.Context, id string, started bool, event *contract.Event, failure string) error {
	if (event == nil) == (failure == "") {
		return errors.New("figure child needs either a result or a failure")
	}
	var encoded any
	if event != nil {
		if !started || event.ID != id || event.Kind != "figure_result" || event.Actor != "adapter" || !json.Valid(event.Body) {
			return errors.New("invalid figure child result")
		}
		body, err := json.Marshal(event)
		if err != nil {
			return err
		}
		encoded = string(body)
	}
	expected := 0
	if started {
		expected = 1
	}
	return s.write(ctx, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, `UPDATE ain_batch_children SET state=2,result=?,failure=?
			WHERE id=? AND state=? AND EXISTS (SELECT 1 FROM ain_intents WHERE id=parent_id AND completed=0)`,
			encoded, failure, id, expected)
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err != nil || count == 1 {
			return err
		}
		return contract.ErrConflict
	})
}

// StopQueuedBatchChildren prevents any additional dispatch for the parent.
// A child already claimed by another process still requires remote verification.
func (s *SQLite) StopQueuedBatchChildren(ctx context.Context, parentID, failure string) error {
	if failure == "" {
		return errors.New("queued figure stop requires a reason")
	}
	return s.write(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `UPDATE ain_batch_children SET state=2,failure=?
			WHERE parent_id=? AND state=0 AND EXISTS (
				SELECT 1 FROM ain_intents WHERE id=parent_id AND completed=0
			)`, failure, parentID)
		return err
	})
}
