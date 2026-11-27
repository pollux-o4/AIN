package runner

import (
	"context"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/sessions"
)

// Activity reprojects a current durable turn on demand. It never attaches or
// starts jobs and therefore can be scoped to an individual HTTP observation.
func (r *Runner) Activity(ctx context.Context, runID string) (sessions.Activity, error) {
	intent, err := r.pendingFor(ctx, runID)
	if err != nil {
		return sessions.Activity{}, err
	}
	if intent == nil {
		return sessions.Activity{}, contract.ErrNotFound
	}
	planned, err := decodeAction(*intent)
	if err != nil {
		return sessions.Activity{}, err
	}
	if batchAction(planned.Action) {
		return sessions.Activity{Phase: "waiting", Steps: []sessions.Step{}}, nil
	}
	ref := queryRef(intent, planned.MessageID)
	assignment := sessions.Assignment{Remote: ref, MessageID: planned.MessageID}
	if planned.Session != nil && planned.Session.Reuse != nil {
		assignment = *planned.Session.Reuse
	}
	snapshot, err := r.paseo.Snapshot(ctx, ref)
	if err != nil {
		return sessions.Activity{Phase: "unavailable", Steps: []sessions.Step{}}, err
	}
	current, err := r.pendingFor(ctx, runID)
	if err != nil {
		return sessions.Activity{}, err
	}
	if current == nil || current.ID != intent.ID {
		return sessions.Activity{}, contract.ErrConflict
	}
	return sessions.ProjectActivity(snapshot, assignment)
}
