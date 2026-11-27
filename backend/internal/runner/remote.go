package runner

import (
	"context"
	"errors"
	"sync/atomic"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

func (r *Runner) awaitTerminal(ctx context.Context, intent *contract.Intent, messageID string) (contract.Snapshot, error) {
	current, err := r.confirm(ctx, intent, messageID)
	if err != nil || terminal(current.Status) {
		return current, err
	}
	cancelled := false
	if expired(r.cfg.Now(), intent.Deadline) {
		current, err = r.cancelRemote(ctx, intent, messageID)
		if err != nil || terminal(current.Status) {
			return current, err
		}
		cancelled = true
	}

	watchCtx, stop := context.WithCancel(ctx)
	finished := make(chan struct{})
	pulse := make(chan struct{}, 1)
	ref := queryRef(intent, messageID)
	var observedUsage atomic.Pointer[contract.Snapshot]
	go func() {
		defer close(finished)
		r.paseo.Watch(watchCtx, ref, func(snapshot contract.Snapshot) error {
			if snapshot.Status == "completed" {
				observedUsage.Store(&snapshot)
			} else {
				observedUsage.Store(nil)
			}
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
			current, err = r.cancelRemote(ctx, intent, messageID)
			cancelled = true
			polls = 0
		} else {
			current, err = r.confirm(ctx, intent, messageID)
		}
		if err != nil || terminal(current.Status) {
			if err == nil {
				current.Usage = corroboratedUsage(current, observedUsage.Load())
			}
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

func (r *Runner) confirm(ctx context.Context, intent *contract.Intent, messageID string) (contract.Snapshot, error) {
	ref := queryRef(intent, messageID)
	if ref.AgentID == "" || messageID == "" {
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
		(observed.TurnID != "" && observed.TurnID != ref.TurnID) ||
		(ref.After > 0 && observed.After < ref.After) ||
		(observed.TurnID == "" && (intent.Remote.TurnID != "" || terminal(snapshot.Status))) {
		return contract.Snapshot{}, contract.ErrDeliveryUncertain
	}
	if observed.TurnID != "" && observed != intent.Remote {
		if err := r.store.Bind(ctx, intent.ID, observed); err != nil {
			return contract.Snapshot{}, err
		}
		intent.Remote = observed
	}
	return snapshot, nil
}

func queryRef(intent *contract.Intent, messageID string) contract.RemoteRef {
	ref := intent.Remote
	if ref.AgentID == "" {
		ref.AgentID = intent.AgentID
	}
	ref.TurnID = messageID
	return ref
}

func (r *Runner) cancelRemote(ctx context.Context, intent *contract.Intent, messageID string) (contract.Snapshot, error) {
	if intent.Remote.AgentID == "" || intent.Remote.TurnID != messageID {
		return contract.Snapshot{}, contract.ErrDeliveryUncertain
	}
	if err := r.paseo.Cancel(ctx, intent.Remote); err != nil {
		// Cancellation may have succeeded before the response was lost.
		snapshot, queryErr := r.confirm(ctx, intent, messageID)
		if queryErr == nil && terminal(snapshot.Status) {
			return snapshot, nil
		}
		return contract.Snapshot{}, errors.Join(contract.ErrDeliveryUncertain, err, queryErr)
	}
	return r.confirm(ctx, intent, messageID)
}

func terminal(status string) bool {
	switch status {
	case "completed", "failed", "cancelled", "stopped":
		return true
	default:
		return false
	}
}
