package runner

import (
	"context"
	"errors"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

func (r *Runner) awaitTerminal(ctx context.Context, intent *contract.Intent) (contract.Snapshot, error) {
	current, err := r.confirm(ctx, intent)
	if err != nil || terminal(current.Status) {
		return current, err
	}
	cancelled := false
	if expired(r.cfg.Now(), intent.Deadline) {
		current, err = r.cancelRemote(ctx, intent)
		if err != nil || terminal(current.Status) {
			return current, err
		}
		cancelled = true
	}

	watchCtx, stop := context.WithCancel(ctx)
	finished := make(chan struct{})
	pulse := make(chan struct{}, 1)
	ref := current.Ref
	go func() {
		defer close(finished)
		r.paseo.Watch(watchCtx, ref, func(contract.Snapshot) error {
			select {
			case pulse <- struct{}{}:
			default:
			}
			return watchCtx.Err()
		})
	}()
	defer func() {
		stop()
		<-finished
	}()

	var polls int
	timer := r.recheckTimer(intent.Deadline, cancelled)
	for {
		select {
		case <-ctx.Done():
			return contract.Snapshot{}, ctx.Err()
		case <-timer:
			polls++
			timer = nil
		case <-pulse:
		}
		if !cancelled && expired(r.cfg.Now(), intent.Deadline) {
			current, err = r.cancelRemote(ctx, intent)
			cancelled = true
			polls = 0
		} else {
			current, err = r.confirm(ctx, intent)
		}
		if err != nil || terminal(current.Status) {
			return current, err
		}
		if timer != nil {
			continue
		}
		if polls < r.cfg.MaxRechecks {
			timer = r.recheckTimer(intent.Deadline, cancelled)
		} else if !cancelled && !intent.Deadline.IsZero() {
			timer = r.cfg.After(max(0, intent.Deadline.Sub(r.cfg.Now())))
		} else {
			return contract.Snapshot{}, contract.ErrDeliveryUncertain
		}
	}
}

func expired(now, deadline time.Time) bool {
	return !deadline.IsZero() && !now.Before(deadline)
}

func (r *Runner) recheckTimer(deadline time.Time, cancelled bool) <-chan time.Time {
	delay := r.cfg.RecheckInterval
	if !cancelled && !deadline.IsZero() {
		delay = min(delay, max(0, deadline.Sub(r.cfg.Now())))
	}
	return r.cfg.After(delay)
}

func (r *Runner) confirm(ctx context.Context, intent *contract.Intent) (contract.Snapshot, error) {
	ref := intent.Remote
	if ref.AgentID == "" {
		ref.AgentID = intent.AgentID
	}
	if ref.AgentID == "" {
		return contract.Snapshot{}, contract.ErrDeliveryUncertain
	}
	snapshot, err := r.paseo.Snapshot(ctx, ref)
	switch {
	case ctx.Err() != nil:
		return contract.Snapshot{}, ctx.Err()
	case err != nil:
		return contract.Snapshot{}, errors.Join(contract.ErrDeliveryUncertain, err)
	}
	observed := snapshot.Ref
	if observed.AgentID != ref.AgentID ||
		(ref.Epoch != "" && observed.Epoch != ref.Epoch) ||
		(ref.TurnID != "" && observed.TurnID != ref.TurnID) ||
		(ref.After > 0 && observed.After < ref.After) ||
		(terminal(snapshot.Status) && observed.TurnID == "") {
		return contract.Snapshot{}, contract.ErrDeliveryUncertain
	}
	if observed != intent.Remote {
		if err := r.store.Bind(ctx, intent.ID, observed); err != nil {
			return contract.Snapshot{}, err
		}
		intent.Remote = observed
	}
	return snapshot, nil
}

func (r *Runner) cancelRemote(ctx context.Context, intent *contract.Intent) (contract.Snapshot, error) {
	if intent.Remote.AgentID == "" {
		return contract.Snapshot{}, contract.ErrDeliveryUncertain
	}
	if err := r.paseo.Cancel(ctx, intent.Remote); err != nil {
		// Cancellation may have succeeded before the response was lost.
		snapshot, queryErr := r.confirm(ctx, intent)
		if queryErr == nil && terminal(snapshot.Status) {
			return snapshot, nil
		}
		return contract.Snapshot{}, errors.Join(contract.ErrDeliveryUncertain, err, queryErr)
	}
	return r.confirm(ctx, intent)
}

func terminal(status string) bool {
	switch status {
	case "completed", "failed", "cancelled", "stopped":
		return true
	default:
		return false
	}
}
