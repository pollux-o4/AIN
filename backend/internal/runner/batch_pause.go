package runner

import (
	"context"
	"errors"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/figuredomain"
)

func (r *Runner) pauseBatch(ctx context.Context, run contract.Run, parent contract.Intent, planned reservedAction) error {
	store, ok := r.store.(batchStore)
	if !ok {
		return errors.New("figure batch store is unavailable")
	}
	if err := store.StopQueuedBatchChildren(ctx, parent.ID, "시작하기 전에 중단했습니다."); err != nil {
		return err
	}
	children, err := store.BatchChildren(ctx, parent.ID)
	if err != nil {
		return err
	}
	if len(children) == 0 {
		return errors.New("figure batch is missing durable children")
	}
	var unconfirmed []error
	for _, child := range children {
		if settled(child) {
			continue
		}
		if !child.Started {
			unconfirmed = append(unconfirmed, contract.ErrConflict)
			continue
		}
		if err := r.pauseChild(ctx, store, child); err != nil {
			unconfirmed = append(unconfirmed, err)
		}
	}
	if len(unconfirmed) > 0 {
		return errors.Join(unconfirmed...)
	}
	children, err = store.BatchChildren(ctx, parent.ID)
	if err != nil {
		return err
	}
	event, err := collectBatch(parent.ID, planned.Action, children)
	var completed *contract.Event
	switch {
	case err == nil:
		completed = &event
	case !errors.Is(err, figuredomain.ErrNoFiguresPrepared):
		return err
	}
	paused, err := r.cfg.Paused(run, completed)
	if err != nil {
		return err
	}
	if err := r.store.Commit(ctx, run.Version, parent.ID, paused); err != nil {
		return err
	}
	r.requestRecovery()
	return nil
}

func (r *Runner) pauseChild(ctx context.Context, store batchStore, child contract.BatchChild) error {
	intent := child.Intent
	plan, err := decodeAction(intent)
	if err != nil {
		return err
	}
	snapshot, err := r.confirm(ctx, &intent, plan.MessageID)
	if err != nil {
		return err
	}
	if !terminal(snapshot.Status) {
		snapshot, err = r.cancelRemote(ctx, &intent, plan.MessageID)
		if err != nil {
			return err
		}
		if !terminal(snapshot.Status) {
			return contract.ErrDeliveryUncertain
		}
	}
	return r.persistBatchSnapshot(ctx, store, child, plan, snapshot)
}
