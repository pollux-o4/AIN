package runner

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/figuredomain"
)

type batchStore interface {
	ReserveBatch(context.Context, int64, contract.Run, contract.Intent, []contract.Intent) error
	BatchChildren(context.Context, string) ([]contract.BatchChild, error)
	ClaimBatchChild(context.Context, string, int) (bool, error)
	FinishBatchChild(context.Context, string, bool, *contract.Event, string) error
	StopQueuedBatchChildren(context.Context, string, string) error
}

type limitedStore interface {
	ReserveWithinLimit(context.Context, int64, contract.Run, contract.Intent, int) (bool, error)
}

func (r *Runner) startBatch(ctx context.Context, run contract.Run, parent contract.Action) (bool, error) {
	store, ok := r.store.(batchStore)
	if !ok {
		return false, errors.New("figure batch store is unavailable")
	}
	parts, err := figuredomain.PartActions(parent)
	if err != nil {
		return false, err
	}
	reserved, err := r.cfg.Reserve(run, parent)
	if err != nil {
		return false, err
	}
	parentID := contract.IntentID(run, parent)
	parent.WorkID = parentID
	planned := reservedAction{Action: parent, Version: reserved.Version}
	value, err := json.Marshal(planned)
	if err != nil {
		return false, err
	}
	deadline := r.cfg.Now().Add(r.cfg.TurnLimit)
	intent := contract.Intent{ID: parentID, RunID: run.ID, Action: value, Deadline: deadline}
	children := make([]contract.Intent, 0, len(parts))
	for _, action := range parts {
		id := contract.IntentID(run, action)
		agent := agentID(id)
		action.WorkID = id
		childPlan, err := json.Marshal(reservedAction{Action: action, Version: reserved.Version, MessageID: agent})
		if err != nil {
			return false, err
		}
		children = append(children, contract.Intent{ID: id, RunID: run.ID, AgentID: agent, Action: childPlan, Deadline: deadline})
	}
	if err := store.ReserveBatch(ctx, run.Version, reserved, intent, children); err != nil {
		return false, err
	}
	return r.finishBatch(ctx, reserved, intent, planned)
}

func (r *Runner) finishBatch(ctx context.Context, run contract.Run, parent contract.Intent, planned reservedAction) (bool, error) {
	store, ok := r.store.(batchStore)
	if !ok {
		return false, errors.New("figure batch store is unavailable")
	}
	childCtx, cancel := context.WithCancel(ctx)
	var workers sync.WaitGroup
	defer func() { cancel(); workers.Wait() }()
	completed := make(chan error, r.cfg.Workers)
	attempted := map[string]bool{}
	active := 0
	var failures []error
	launch := func(child contract.BatchChild, plan reservedAction, spec *contract.SessionSpec) {
		attempted[child.ID] = true
		active++
		workers.Go(func() {
			err := r.runBatchChild(childCtx, store, child, plan, spec)
			completed <- err
		})
	}
	for {
		children, err := store.BatchChildren(ctx, parent.ID)
		if err != nil {
			return false, err
		}
		if len(children) == 0 {
			return false, errors.New("figure batch is missing durable children")
		}
		var queued []contract.BatchChild
		for _, child := range children {
			if settled(child) || attempted[child.ID] {
				continue
			}
			if !child.Started {
				queued = append(queued, child)
				continue
			}
			plan, err := decodeAction(child.Intent)
			if err != nil || plan.Version != planned.Version || active >= r.cfg.Workers {
				return false, errors.New("invalid reserved figure child")
			}
			// A previously claimed child may already have reached the daemon.
			launch(child, plan, nil)
		}
		for _, child := range queued {
			if active >= r.cfg.Workers {
				break
			}
			plan, spec, claimed, finished, err := r.prepareBatchChild(ctx, store, run, child, planned.Version)
			if err != nil {
				return false, err
			}
			if finished {
				attempted[child.ID] = true
				continue
			}
			if !claimed {
				break
			}
			child.Started = true
			launch(child, plan, &spec)
		}
		if active == 0 {
			return r.commitBatch(ctx, store, run, parent, planned, failures)
		}
		select {
		case <-ctx.Done():
			return false, ctx.Err()
		case err := <-completed:
			active--
			if err != nil {
				failures = append(failures, err)
			}
		}
	}
}

func (r *Runner) prepareBatchChild(ctx context.Context, store batchStore, run contract.Run, child contract.BatchChild, version int64) (reservedAction, contract.SessionSpec, bool, bool, error) {
	plan, err := decodeAction(child.Intent)
	if err != nil || plan.Version != version {
		return plan, contract.SessionSpec{}, false, false, errors.New("invalid queued figure part")
	}
	if !r.cfg.Now().Before(child.Deadline) {
		err := store.FinishBatchChild(ctx, child.ID, false, nil, "실행 기한 전에 시작하지 못했습니다.")
		return plan, contract.SessionSpec{}, false, err == nil, err
	}
	spec, err := r.turns.BuildTurn(run, plan.Action)
	if err != nil || spec.Prompt == "" {
		recordErr := store.FinishBatchChild(ctx, child.ID, false, nil, "그림 작업을 준비하지 못했습니다.")
		return plan, spec, false, recordErr == nil, recordErr
	}
	claimed, err := store.ClaimBatchChild(ctx, child.ID, r.cfg.Workers)
	return plan, spec, claimed, false, err
}

func (r *Runner) runBatchChild(ctx context.Context, store batchStore, child contract.BatchChild, plan reservedAction, spec *contract.SessionSpec) error {
	intent := child.Intent
	if spec != nil {
		if ctx.Err() != nil {
			// This goroutine still knows it has not attempted Create. Recovery
			// alone would have to treat the claim as ambiguous.
			cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), time.Second)
			defer cancel()
			return store.FinishBatchChild(cleanup, child.ID, true, nil, "그림 작업을 시작하기 전에 중단했습니다.")
		}
		if err := r.trackFresh(ctx, intent, plan, spec); err != nil {
			recordErr := store.FinishBatchChild(ctx, child.ID, true, nil, "그림 세션을 준비하지 못했습니다.")
			return errors.Join(err, recordErr)
		}
		ref, err := r.paseo.Create(ctx, intent.AgentID, *spec)
		if err == nil {
			if ref.AgentID != intent.AgentID || ref.TurnID != plan.MessageID {
				return contract.ErrDeliveryUncertain
			}
			if err := r.store.Bind(ctx, intent.ID, contract.RemoteRef{AgentID: ref.AgentID}); err != nil {
				return err
			}
			intent.Remote.AgentID = ref.AgentID
		}
	}
	snapshot, err := r.awaitTerminal(ctx, &intent, plan.MessageID)
	if err != nil {
		return err
	}
	return r.persistBatchSnapshot(ctx, store, child, plan, snapshot)
}

func (r *Runner) persistBatchSnapshot(ctx context.Context, store batchStore, child contract.BatchChild, plan reservedAction, snapshot contract.Snapshot) error {
	var event *contract.Event
	failure := ""
	if snapshot.Status == "completed" {
		validated, err := r.terminalEvent(child.ID, plan.Action, snapshot)
		if err != nil || checkedResult(validated, plan.Action) == nil {
			failure = "그림 결과 형식을 확인하지 못했습니다."
		} else {
			event = &validated
		}
	} else {
		failure = "그림 실행이 끝났으나 준비된 결과가 없습니다."
	}
	if err := store.FinishBatchChild(ctx, child.ID, true, event, failure); err != nil {
		return err
	}
	r.releaseSession(ctx, child.Intent, plan, snapshot, false)
	r.requestRecovery()
	return nil
}

func settled(child contract.BatchChild) bool { return child.Result != nil || child.Failure != "" }

func checkedResult(event contract.Event, action contract.Action) json.RawMessage {
	var metadata, body struct {
		Revision        int64  `json:"revision"`
		ExpectedVersion int64  `json:"expectedVersion"`
		Stage           string `json:"stage"`
		FigureID        string `json:"figureId"`
		Pass            string `json:"pass"`
		Output          struct {
			Figures []json.RawMessage `json:"figures"`
		} `json:"output"`
	}
	if event.Actor != "adapter" || event.Kind != "figure_result" ||
		json.Unmarshal(action.Input, &metadata) != nil || json.Unmarshal(event.Body, &body) != nil ||
		body.Revision != metadata.Revision || body.ExpectedVersion != action.StateVersion ||
		body.Stage != action.Stage || body.FigureID != action.FigureID || body.Pass != metadata.Pass ||
		len(body.Output.Figures) != 1 {
		return nil
	}
	var figure struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(body.Output.Figures[0], &figure) != nil || figure.ID != action.FigureID {
		return nil
	}
	return body.Output.Figures[0]
}

func (r *Runner) commitBatch(ctx context.Context, store batchStore, run contract.Run, parent contract.Intent, planned reservedAction, issues []error) (bool, error) {
	children, err := store.BatchChildren(ctx, parent.ID)
	if err != nil {
		return false, err
	}
	event, err := collectBatch(parent.ID, planned.Action, children)
	switch {
	case errors.Is(err, errBatchPending):
		return false, errors.Join(issues...)
	case errors.Is(err, figuredomain.ErrNoFiguresPrepared):
		event, err = batchFailure(parent.ID, run, planned.Action)
	}
	if err != nil {
		return false, err
	}
	next, err := r.rules.Reduce(run, event)
	if err != nil {
		return false, err
	}
	if err := r.store.Commit(ctx, run.Version, parent.ID, next); err != nil {
		return false, err
	}
	r.requestRecovery()
	return true, nil
}

var errBatchPending = errors.New("figure batch still has pending children")

func collectBatch(id string, parent contract.Action, children []contract.BatchChild) (contract.Event, error) {
	results := make([]figuredomain.ChildResult, 0, len(children))
	for _, child := range children {
		if !settled(child) {
			return contract.Event{}, errBatchPending
		}
		plan, err := decodeAction(child.Intent)
		if err != nil {
			return contract.Event{}, err
		}
		var input struct {
			Revision int64  `json:"revision"`
			Pass     string `json:"pass"`
		}
		if json.Unmarshal(plan.Action.Input, &input) != nil {
			return contract.Event{}, errors.New("invalid figure child metadata")
		}
		result := figuredomain.ChildResult{FigureID: plan.Action.FigureID, Revision: input.Revision, Pass: input.Pass, Failure: child.Failure}
		if child.Result != nil {
			result.Figure = checkedResult(*child.Result, plan.Action)
			if result.Figure == nil {
				return contract.Event{}, errors.New("stored figure result failed identity validation")
			}
		}
		results = append(results, result)
	}
	event, err := figuredomain.Collect(parent, id, parent.StateVersion, results)
	if err == nil {
		event.Usage = completeBatchUsage(children)
	}
	return event, err
}

func batchFailure(id string, run contract.Run, action contract.Action) (contract.Event, error) {
	var record struct {
		State struct {
			Version  int64  `json:"version"`
			Revision int64  `json:"revision"`
			Stage    string `json:"stage"`
		} `json:"state"`
	}
	if json.Unmarshal(run.Value, &record) != nil || record.State.Version != action.StateVersion {
		return contract.Event{}, contract.ErrConflict
	}
	body, err := json.Marshal(map[string]any{
		"expectedVersion": action.StateVersion, "revision": record.State.Revision, "stage": record.State.Stage,
		"error": "묶음에서 준비된 그림이 없습니다.",
	})
	return contract.Event{ID: id, Actor: "adapter", Kind: "fail", Body: body}, err
}
