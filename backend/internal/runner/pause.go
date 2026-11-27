package runner

import (
	"context"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

type PauseRecord func(contract.Run) (contract.Run, error)

func (r *Runner) Pause(ctx context.Context, id string) error {
	return r.pause(ctx, id, nil, nil)
}

// PauseCommand records a user operation in the same commit as the confirmed pause.
func (r *Runner) PauseCommand(ctx context.Context, id string, version int64, record PauseRecord) error {
	return r.pause(ctx, id, &version, record)
}

func (r *Runner) pause(ctx context.Context, id string, version *int64, record PauseRecord) error {
	transition := func(run contract.Run, result *contract.Event) (contract.Run, error) {
		next, err := r.cfg.Paused(run, result)
		if err == nil && record != nil {
			return record(next)
		}
		return next, err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	r.mu.Lock()
	if r.pausing[id] {
		r.mu.Unlock()
		return contract.ErrConflict
	}
	r.pausing[id] = true
	active := r.slots[id]
	if active != nil && active.cancel != nil {
		active.cancel()
	} else {
		active = nil
	}
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		delete(r.pausing, id)
		r.mu.Unlock()
		r.requestRecovery()
	}()
	if active != nil {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-active.done:
		}
	}
	run, err := r.store.GetRun(ctx, id)
	if err != nil {
		return err
	}
	if version != nil && *version != run.Version {
		return contract.ErrConflict
	}
	intent, err := r.pendingFor(ctx, id)
	if err != nil {
		return err
	}
	if intent == nil {
		paused, err := transition(run, nil)
		if err != nil {
			return err
		}
		return r.store.UpdateRun(ctx, run.Version, paused)
	}
	planned, err := decodeAction(*intent)
	if err != nil {
		return err
	}
	if planned.Version != run.Version {
		return contract.ErrConflict
	}
	if batchAction(planned.Action) {
		return r.pauseBatch(ctx, run, *intent, planned, transition)
	}
	snapshot, err := r.confirm(ctx, intent, planned.MessageID)
	if err != nil {
		return err
	}
	if !terminal(snapshot.Status) {
		snapshot, err = r.cancelRemote(ctx, intent, planned.MessageID)
		if err != nil {
			return err
		}
		if !terminal(snapshot.Status) {
			return contract.ErrDeliveryUncertain
		}
	}
	if !proveSession(planned, snapshot) {
		return contract.ErrDeliveryUncertain
	}
	var result *contract.Event
	if snapshot.Status == "completed" {
		event, err := r.terminalEvent(intent.ID, planned.Action, snapshot)
		if err != nil {
			return err
		}
		result = &event
	}
	paused, err := transition(run, result)
	if err != nil {
		return err
	}
	if err := r.store.Commit(ctx, run.Version, intent.ID, paused); err != nil {
		return err
	}
	r.releaseSession(ctx, *intent, planned, snapshot, false)
	r.requestRecovery()
	return nil
}
