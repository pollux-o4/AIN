package runner

import (
	"context"
	"errors"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

const (
	sessionSweepInterval = time.Minute
	sessionSweepTimeout  = 5 * time.Second
)

func (r *Runner) sweepSessions(ctx context.Context) {
	ticks := r.cfg.SessionTicks
	if ticks == nil {
		ticker := time.NewTicker(sessionSweepInterval)
		defer ticker.Stop()
		ticks = ticker.C
	}
	r.sweep(ctx, false)
	for {
		select {
		case <-ctx.Done():
			return
		case _, ok := <-ticks:
			if !ok {
				return
			}
			r.sweep(ctx, false)
		}
	}
}

func (r *Runner) sweep(ctx context.Context, all bool) {
	if all {
		ctx = context.WithoutCancel(ctx)
	}
	bounded, cancel := context.WithTimeout(ctx, sessionSweepTimeout)
	defer cancel()
	_, err := r.cfg.Sessions.Sweep(bounded, r.activeAgent, all)
	r.report("", err)
}

var matchingAgent = errors.New("matching durable active agent")

func (r *Runner) activeAgent(ctx context.Context, agent string) (bool, error) {
	err := r.store.ScanPending(ctx, func(intent contract.Intent) error {
		if referencesAgent(intent, agent) {
			return matchingAgent
		}
		if intent.AgentID == "" && intent.Remote.AgentID == "" {
			if store, ok := r.store.(batchStore); ok {
				children, err := store.BatchChildren(ctx, intent.ID)
				if err != nil {
					return err
				}
				for _, child := range children {
					if child.Started && !settled(child) && referencesAgent(child.Intent, agent) {
						return matchingAgent
					}
				}
			}
		}
		return nil
	})
	if errors.Is(err, matchingAgent) {
		return true, nil
	}
	return false, err
}

func referencesAgent(intent contract.Intent, agent string) bool {
	return agent != "" && (intent.AgentID == agent || intent.Remote.AgentID == agent)
}
