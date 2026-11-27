package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing/fstest"
	"time"

	"github.com/google/uuid"
	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/editorial"
	"github.com/pollux-o4/AIN/backend/internal/runner"
	ainruntime "github.com/pollux-o4/AIN/backend/internal/runtime"
	"github.com/pollux-o4/AIN/backend/internal/sessions"
	"github.com/pollux-o4/AIN/backend/internal/store"
	"github.com/pollux-o4/AIN/backend/internal/writingai"
)

const articleCallLimit = 30

type articleBudget struct {
	wire
	limit                  int32
	calls, created, reused atomic.Int32
}

func (b *articleBudget) take() error {
	if b.calls.Add(1) > b.limit {
		b.calls.Add(-1)
		return errors.New("live article call budget reached")
	}
	return nil
}

func (b *articleBudget) Create(ctx context.Context, id string, spec contract.SessionSpec) (contract.RemoteRef, error) {
	if err := ctx.Err(); err != nil {
		return contract.RemoteRef{}, err
	}
	if err := b.take(); err != nil {
		return contract.RemoteRef{}, err
	}
	b.created.Add(1)
	return b.wire.Create(ctx, id, spec)
}

func (b *articleBudget) Send(ctx context.Context, ref contract.RemoteRef, text string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := b.take(); err != nil {
		return err
	}
	b.reused.Add(1)
	return b.wire.Send(ctx, ref, text)
}

func article(parent context.Context, client wire, cfg config, mode string, report *probeReport) error {
	limit := int32(articleCallLimit)
	if cfg.Feedback != "" {
		limit *= 2
	}
	budget := &articleBudget{wire: client, limit: limit}
	defer func() {
		report.ArticleCalls = int(budget.calls.Load())
		report.Created = int(budget.created.Load())
		report.Reused = int(budget.reused.Load())
	}()
	db, err := store.Open(parent, filepath.Join(cfg.Root, "editorial.sqlite"))
	if err != nil {
		return errors.New("isolated editorial database could not be opened")
	}
	defer db.Close()
	registry, err := db.SessionRegistry(parent)
	if err != nil {
		return errors.New("isolated session store could not be opened")
	}
	manager, err := sessions.New(registry, budget, sessions.Config{Owner: cfg.Root})
	if err != nil {
		return errors.New("isolated session manager could not be started")
	}
	sessionSpec := func(request model) contract.SessionSpec {
		return contract.SessionSpec{Provider: request.Provider, Model: request.Model, Thinking: request.Thinking, Mode: mode, WorkDir: cfg.Root}
	}
	builder := writingai.New(writingai.Config{Base: sessionSpec(cfg.Standard), High: sessionSpec(cfg.High)})
	token := uuid.NewString() + uuid.NewString()
	session := uuid.NewString() + uuid.NewString()
	var observedError atomic.Bool
	handler, scheduler, err := ainruntime.Editorial(db, budget, ainruntime.Turns{
		Writing: builder, WritingRoot: filepath.Join(cfg.Root, "workspaces"),
	}, ainruntime.EditorialConfig{
		Assets:     fstest.MapFS{"index.html": {Data: []byte("<html></html>")}},
		SessionKey: session, AgentToken: token, Outbox: filepath.Join(cfg.Root, "unused-outbox"),
		Runner: runner.Config{
			Sessions: manager, Workers: 1, Queue: 8, TurnLimit: 5 * time.Minute, RecheckInterval: 2 * time.Second, MaxRechecks: 5,
			OnError: func(_ string, _ error) { observedError.Store(true) },
			Reserve: func(run contract.Run, action contract.Action) (contract.Run, error) {
				if budget.calls.Load() >= budget.limit {
					return run, errors.New("live article call budget reached")
				}
				return editorial.ReserveTurn(time.Now(), run, action)
			},
		},
	})
	if err != nil {
		return errors.New("isolated Go editor could not be started")
	}
	// The caller's deadline stops verification first; cleanup still needs the
	// scheduler it is about to pause to remain available.
	loop, stop := context.WithCancel(context.WithoutCancel(parent))
	done := make(chan error, 1)
	go func() { done <- scheduler.Run(loop) }()
	requestID := ""
	runID := ""
	defer func() {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(parent), 12*time.Second)
		defer cancel()
		stop()
		if err := <-done; err != nil {
			report.CleanupIssues = append(report.CleanupIssues, "runner_stop_unconfirmed")
		}
		if runID == "" && requestID != "" {
			if saved, err := db.FindRequest(cleanup, requestID); err == nil {
				runID = saved.ID
			}
		}
		if runID != "" {
			if _, err := db.PendingRun(cleanup, runID); err == nil {
				if err := scheduler.Pause(cleanup, runID); err != nil {
					report.CleanupIssues = append(report.CleanupIssues, "article_stop_unconfirmed")
				}
			} else if !errors.Is(err, contract.ErrNotFound) {
				report.CleanupIssues = append(report.CleanupIssues, "article_inventory_unconfirmed")
			}
		}
		if runID != "" {
			if _, err := db.PendingRun(cleanup, runID); !errors.Is(err, contract.ErrNotFound) &&
				!contains(report.CleanupIssues, "article_stop_unconfirmed") {
				report.CleanupIssues = append(report.CleanupIssues, "article_stop_unconfirmed")
			}
		}
		result, err := manager.Sweep(cleanup, db.IsAgentActive, true)
		if err != nil || result.Deferred != 0 {
			report.CleanupIssues = append(report.CleanupIssues, "session_release_unconfirmed")
		}
	}()

	ctx, cancel := context.WithTimeout(parent, 30*time.Minute)
	defer cancel()
	api, err := newArticleAPI(ctx, handler, token)
	if err != nil {
		return err
	}
	var first articleView
	var payload map[string]json.RawMessage
	if json.Unmarshal(cfg.Input, &payload) != nil || json.Unmarshal(payload["requestId"], &requestID) != nil {
		return errors.New("invalid synthetic article request")
	}
	started := time.Now()
	if err := api.json(ctx, "POST", "", cfg.Input, &first, false); err != nil {
		return err
	}
	runID = first.ID
	first, err = api.await(ctx, runID, 0, &observedError, report)
	if err != nil {
		return err
	}
	saved, err := db.GetRun(ctx, runID)
	if err != nil {
		return errors.New("verified editorial record could not be loaded")
	}
	if err := verifyDraft(ctx, api, first, saved, cfg.Root); err != nil {
		return err
	}
	history, err := api.get(ctx, "/"+runID+"/history")
	if err != nil {
		return err
	}
	if err := putPrivate(cfg.Root, "run.json", saved.Value); err != nil {
		return err
	}
	if err := putPrivate(cfg.Root, "history.json", history); err != nil {
		return err
	}
	if cfg.Feedback != "" {
		action, err := json.Marshal(map[string]any{
			"operationId": "contract-feedback-" + uuid.NewString(), "expectedVersion": first.Version, "type": "feedback", "feedback": cfg.Feedback,
		})
		if err != nil {
			return err
		}
		if err := api.json(ctx, "POST", "/"+runID+"/actions", action, nil, true); err != nil {
			return err
		}
		revised, err := api.await(ctx, runID, first.Revision, &observedError, report)
		if err != nil {
			return err
		}
		report.FeedbackRevision = revised.Revision
	}
	report.DurationMS = time.Since(started).Milliseconds()
	return nil
}

func verifyDraft(ctx context.Context, api *articleAPI, view articleView, run contract.Run, root string) error {
	var record struct {
		State struct {
			Artifacts map[string]struct {
				Revision int64
				Output   struct{ Text string }
			}
			Approval, SatisfiedRevision json.RawMessage
		}
	}
	if json.Unmarshal(run.Value, &record) != nil || string(record.State.Approval) != "null" ||
		string(record.State.SatisfiedRevision) != "null" || len(record.State.Artifacts) != 8 {
		return errors.New("article did not reach the unapproved eight-stage contract")
	}
	for _, stage := range []string{"diagnose", "topic", "audience", "value", "research", "outline", "draft", "review"} {
		if record.State.Artifacts[stage].Revision != view.Revision {
			return errors.New("approved evidence for an editorial stage is missing or stale")
		}
	}
	download, err := api.get(ctx, "/"+view.ID+"/download")
	if err != nil {
		return err
	}
	expected := record.State.Artifacts["draft"].Output.Text
	if !strings.HasSuffix(expected, "\n") {
		expected += "\n"
	}
	if !bytes.Equal(download, []byte(expected)) {
		return errors.New("draft download does not match the saved manuscript")
	}
	return putPrivate(root, "article.txt", download)
}

func contains(values []string, value string) bool {
	for _, entry := range values {
		if entry == value {
			return true
		}
	}
	return false
}
