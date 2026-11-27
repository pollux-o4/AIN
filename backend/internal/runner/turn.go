package runner

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

type reservedAction struct {
	Action    contract.Action
	Version   int64
	MessageID string
}

func (r *Runner) process(ctx context.Context, id string, intent *contract.Intent, candidate bool) (bool, error) {
	if intent == nil && !candidate {
		var err error
		intent, err = r.pendingFor(ctx, id)
		if err != nil {
			return false, err
		}
	}
	run, err := r.store.GetRun(ctx, id)
	if err != nil {
		return false, err
	}
	if intent == nil {
		return r.start(ctx, run)
	}
	planned, err := decodeAction(*intent)
	if err != nil {
		return false, err
	}
	if planned.Version != run.Version {
		return false, contract.ErrConflict
	}
	return r.finish(ctx, run, *intent, planned)
}

func (r *Runner) start(ctx context.Context, run contract.Run) (bool, error) {
	action, err := r.rules.Next(run)
	if err != nil || action.Kind == "" {
		return false, err
	}
	spec, err := r.turns.BuildTurn(run, action)
	if err != nil {
		return false, err
	}
	if spec.Prompt == "" {
		return false, errors.New("Paseo initial prompt is required for turn correlation")
	}
	reserved, err := r.cfg.Reserve(run, action)
	if err != nil {
		return false, err
	}
	id := contract.IntentID(run, action)
	agent := agentID(id)
	planned := reservedAction{Action: action, Version: reserved.Version, MessageID: agent}
	value, err := json.Marshal(planned)
	if err != nil {
		return false, err
	}
	intent := contract.Intent{
		ID: id, RunID: run.ID, AgentID: agent, Action: value, Deadline: r.cfg.Now().Add(r.cfg.TurnLimit),
	}
	if err := r.reserveTurn(ctx, run.Version, reserved, intent); err != nil {
		if errors.Is(err, errAtCapacity) {
			return false, nil
		}
		return false, err
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}
	ref, err := r.paseo.Create(ctx, intent.AgentID, spec)
	if err != nil {
		// A transport error after persistence can be a lost response.
		return r.finish(ctx, reserved, intent, planned)
	}
	if ref.AgentID != intent.AgentID || ref.TurnID != planned.MessageID {
		return false, contract.ErrDeliveryUncertain
	}
	// Creation acknowledges the agent, while a timeline snapshot proves
	// that this exact submitted prompt owns the observed turn.
	if err := r.store.Bind(ctx, intent.ID, contract.RemoteRef{AgentID: ref.AgentID}); err != nil {
		return false, err
	}
	intent.Remote.AgentID = ref.AgentID
	return r.finish(ctx, reserved, intent, planned)
}

func (r *Runner) finish(ctx context.Context, run contract.Run, intent contract.Intent, planned reservedAction) (bool, error) {
	snapshot, err := r.awaitTerminal(ctx, &intent, planned.MessageID)
	if err != nil {
		return false, err
	}
	event, err := r.terminalEvent(intent.ID, planned.Action, snapshot)
	if err != nil {
		return false, err
	}
	next, err := r.rules.Reduce(run, event)
	if err != nil {
		return false, err
	}
	if err := r.store.Commit(ctx, run.Version, intent.ID, next); err != nil {
		return false, err
	}
	r.requestRecovery()
	return true, nil
}

func (r *Runner) terminalEvent(id string, action contract.Action, snapshot contract.Snapshot) (contract.Event, error) {
	event, err := r.turns.ValidateResult(action, snapshot)
	if err != nil {
		return contract.Event{}, err
	}
	event.ID = id
	return event, nil
}

func decodeAction(intent contract.Intent) (reservedAction, error) {
	var reserved reservedAction
	if err := json.Unmarshal(intent.Action, &reserved); err != nil || reserved.Action.Kind == "" {
		return reservedAction{}, errors.New("invalid reserved editorial action")
	}
	if reserved.MessageID == "" {
		reserved.MessageID = intent.Remote.TurnID
		if reserved.MessageID == "" {
			reserved.MessageID = intent.AgentID
		}
	}
	return reserved, nil
}

func (r *Runner) pendingFor(ctx context.Context, id string) (*contract.Intent, error) {
	var found *contract.Intent
	stop := errors.New("matching pending intent read")
	err := r.store.ScanPending(ctx, func(intent contract.Intent) error {
		if intent.RunID != id {
			return nil
		}
		found = &intent
		return stop
	})
	if errors.Is(err, stop) {
		return found, nil
	}
	return nil, err
}

var errAtCapacity = errors.New("durable turn limit reached")

func (r *Runner) reserveTurn(ctx context.Context, version int64, run contract.Run, intent contract.Intent) error {
	r.reserve.Lock()
	defer r.reserve.Unlock()
	count := 0
	err := r.store.ScanPending(ctx, func(contract.Intent) error {
		count++
		if count == r.cfg.Workers {
			return errAtCapacity
		}
		return nil
	})
	if err != nil {
		return err
	}
	return r.store.Reserve(ctx, version, run, intent)
}

// Paseo uses UUID-shaped agent IDs. A custom UUID preserves the same remote
// identity when reconciling an ambiguous response or process crash.
func agentID(intentID string) string {
	sum := sha256.Sum256([]byte(intentID))
	sum[6] = (sum[6] & 0x0f) | 0x80
	sum[8] = (sum[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", sum[0:4], sum[4:6], sum[6:8], sum[8:10], sum[10:16])
}
