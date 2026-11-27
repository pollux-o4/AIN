package runner

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/sessions"
)

// SessionTurns provides model context for a leased writing role. Normal turn
// builders remain usable without a session cache.
type SessionTurns interface {
	BuildTrackedTurn(contract.Run, contract.Action) (contract.SessionSpec, map[string]string, error)
	BuildReuseTurn(contract.Run, contract.Action, map[string]string) (contract.SessionSpec, map[string]string, error)
	SessionRole(contract.Action) (string, bool)
}

type sessionPlan struct {
	Reuse     *sessions.Assignment `json:",omitempty"`
	Delivered map[string]string    `json:",omitempty"`
}

func (r *Runner) buildTrackedTurn(run contract.Run, action contract.Action) (contract.SessionSpec, map[string]string, error) {
	if builder, ok := r.turns.(SessionTurns); ok && r.cfg.Sessions != nil {
		return builder.BuildTrackedTurn(run, action)
	}
	spec, err := r.turns.BuildTurn(run, action)
	return spec, nil, err
}

func (r *Runner) tryReuse(ctx context.Context, before, reserved contract.Run, intent contract.Intent, plan reservedAction, desired contract.SessionSpec) (handled, advanced bool, err error) {
	builder, ok := r.turns.(SessionTurns)
	if !ok || r.cfg.Sessions == nil {
		return false, false, nil
	}
	role, reuse := builder.SessionRole(plan.Action)
	if !reuse || role == "" || plan.Session == nil || plan.Session.Delivered == nil {
		return false, false, nil
	}
	manager := r.cfg.Sessions
	lease, err := manager.Acquire(ctx, sessions.Key{ArticleID: intent.RunID, Role: role}, intent.ID, plan.MessageID, desired)
	if errors.Is(err, sessions.ErrUnavailable) {
		return false, false, nil
	}
	if err != nil {
		return true, false, err
	}
	spec, delivered, err := builder.BuildReuseTurn(before, plan.Action, lease.Delivered())
	if err != nil {
		r.discardClaim(ctx, lease)
		return true, false, err
	}
	persisted := false
	err = manager.Dispatch(ctx, lease, spec, func(ctx context.Context, assignment sessions.Assignment) error {
		if assignment.Remote.AgentID != lease.AgentID() || assignment.MessageID != plan.MessageID {
			return contract.ErrConflict
		}
		intent.AgentID, intent.Remote = assignment.Remote.AgentID, assignment.Remote
		plan.Session = &sessionPlan{Reuse: &assignment, Delivered: delivered}
		if err := r.reservePlannedTurn(ctx, before.Version, reserved, &intent, plan); err != nil {
			return err
		}
		persisted = true
		return nil
	})
	if !persisted {
		r.discardClaim(ctx, lease)
		switch {
		case errors.Is(err, sessions.ErrUnavailable):
			return false, false, nil
		case errors.Is(err, errAtCapacity):
			return true, false, nil
		default:
			return true, false, err
		}
	}
	// Both a successful send and a lost acknowledgement converge on the same
	// lookup. This path never starts a replacement turn.
	r.report(intent.RunID, err)
	advanced, err = r.finish(ctx, reserved, intent, plan)
	return true, advanced, err
}

func (r *Runner) discardClaim(ctx context.Context, lease sessions.Lease) {
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), time.Second)
	defer cancel()
	r.report("", r.cfg.Sessions.Abandon(cleanup, lease))
}

func (r *Runner) trackFresh(ctx context.Context, intent contract.Intent, plan reservedAction, spec *contract.SessionSpec) error {
	if r.cfg.Sessions == nil {
		return nil
	}
	role, _ := r.sessionRole(plan.Action)
	_, err := r.cfg.Sessions.TrackFresh(ctx, sessions.Key{ArticleID: intent.RunID, Role: role}, intent.ID,
		intent.AgentID, plan.MessageID, spec.Provider)
	if err != nil {
		return err
	}
	spec.Labels = maps.Clone(spec.Labels)
	if spec.Labels == nil {
		spec.Labels = map[string]string{}
	}
	maps.Copy(spec.Labels, r.cfg.Sessions.Labels(intent.ID))
	return nil
}

func (r *Runner) sessionRole(action contract.Action) (string, bool) {
	if builder, ok := r.turns.(SessionTurns); ok {
		if role, reuse := builder.SessionRole(action); role != "" {
			return role, reuse
		}
	}
	if action.FigureID != "" {
		return action.Stage + ":" + action.FigureID, false
	}
	return action.Kind + ":" + action.Stage, false
}

func proveSession(plan reservedAction, snapshot contract.Snapshot) bool {
	return plan.Session == nil || plan.Session.Reuse == nil || plan.Session.Reuse.ProvesResult(snapshot)
}

func (r *Runner) releaseSession(ctx context.Context, intent contract.Intent, plan reservedAction, snapshot contract.Snapshot, keep bool) {
	if r.cfg.Sessions == nil {
		return
	}
	release, cancel := context.WithTimeout(context.WithoutCancel(ctx), sessionSweepTimeout)
	defer cancel()
	agent := intent.AgentID
	if intent.Remote.AgentID != "" {
		agent = intent.Remote.AgentID
	}
	lease, err := r.cfg.Sessions.Recover(release, agent, intent.ID)
	if err != nil {
		r.report(intent.RunID, err)
		return
	}
	var delivered map[string]string
	if plan.Session != nil {
		delivered = plan.Session.Delivered
	}
	_, reuse := r.sessionRole(plan.Action)
	r.report(intent.RunID, r.cfg.Sessions.Release(release, lease, snapshot, delivered, keep && reuse && delivered != nil))
}

func (r *Runner) failBeforeDispatch(ctx context.Context, run contract.Run, intent contract.Intent, plan reservedAction, cause error) (bool, error) {
	var record struct {
		State struct {
			Version  int64  `json:"version"`
			Revision int64  `json:"revision"`
			Stage    string `json:"stage"`
		}
	}
	if json.Unmarshal(run.Value, &record) != nil || record.State.Version != plan.Action.StateVersion ||
		record.State.Revision < 1 || record.State.Stage == "" {
		return false, errors.Join(cause, contract.ErrConflict)
	}
	body, err := json.Marshal(map[string]any{
		"expectedVersion": record.State.Version, "revision": record.State.Revision,
		"stage": record.State.Stage, "error": "AI 세션을 준비하지 못했습니다.",
	})
	if err != nil {
		return false, errors.Join(cause, err)
	}
	event := contract.Event{ID: intent.ID, Actor: "adapter", Kind: "fail", Body: body}
	next, err := r.rules.Reduce(run, event)
	if err != nil {
		return false, errors.Join(cause, err)
	}
	if err := r.store.Commit(ctx, run.Version, intent.ID, next); err != nil {
		return false, errors.Join(cause, err)
	}
	r.requestRecovery()
	return false, cause
}
