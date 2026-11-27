package runner

import (
	"context"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

func (r *Runner) Pause(ctx context.Context, id string) error {
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
	intent, err := r.pendingFor(ctx, id)
	if err != nil {
		return err
	}
	if intent == nil {
		paused, err := r.cfg.Paused(run, nil)
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
	snapshot, err := r.confirm(ctx, intent)
	if err != nil {
		return err
	}
	if !terminal(snapshot.Status) {
		snapshot, err = r.cancelRemote(ctx, intent)
		if err != nil {
			return err
		}
		if !terminal(snapshot.Status) {
			return contract.ErrDeliveryUncertain
		}
	}
	var result *contract.Event
	if snapshot.Status == "completed" {
		event, err := r.terminalEvent(intent.ID, planned.Action, snapshot)
		if err != nil {
			return err
		}
		result = &event
	}
	paused, err := r.cfg.Paused(run, result)
	if err != nil {
		return err
	}
	if err := r.store.Commit(ctx, run.Version, intent.ID, paused); err != nil {
		return err
	}
	r.requestRecovery()
	return nil
}
