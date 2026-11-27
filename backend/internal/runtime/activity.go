package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/httpapi"
	"github.com/pollux-o4/AIN/backend/internal/sessions"
)

// ActivityRoutes connects the authenticated HTTP stream to read-only
// observations. No scheduler state or provider operation is changed here.
func ActivityRoutes(mux *http.ServeMux, store contract.Store, paseo contract.Paseo, rules contract.EditorialRules) {
	httpapi.ActivityRoute(mux, activitySource{store: store, watcher: paseo, rules: rules, ticks: activityTicks})
}

type activityStore interface {
	GetRun(context.Context, string) (contract.Run, error)
	ScanPending(context.Context, func(contract.Intent) error) error
}

type pendingRunReader interface {
	PendingRun(context.Context, string) (contract.Intent, error)
}

type batchActivityReader interface {
	BatchChildren(context.Context, string) ([]contract.BatchChild, error)
}

type activityWatcher interface {
	Watch(context.Context, contract.RemoteRef, func(contract.Snapshot) error) error
}

type activitySource struct {
	store   activityStore
	watcher activityWatcher
	rules   contract.EditorialRules
	ticks   func() (<-chan time.Time, func())
}

type publicActivity struct {
	Revision int64  `json:"revision"`
	Stage    string `json:"stage"`
	Name     string `json:"name"`
	Active   bool   `json:"active"`
	sessions.Activity
}

type activityKey struct {
	version, revision                            int64
	stage, parentID, childID, agentID, messageID string
}

type activityTarget struct {
	key        activityKey
	assignment sessions.Assignment
}

type currentActivity struct {
	base   publicActivity
	target activityTarget
}

func activityTicks() (<-chan time.Time, func()) {
	ticker := time.NewTicker(time.Second)
	return ticker.C, ticker.Stop
}

func (s activitySource) OpenActivity(parent context.Context, id string) (<-chan json.RawMessage, func(), error) {
	if err := parent.Err(); err != nil {
		return nil, nil, err
	}
	first, err := s.read(parent, id)
	if err != nil {
		return nil, nil, err
	}
	ctx, cancel := context.WithCancel(parent)
	out := make(chan json.RawMessage, 1)
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer close(out)
		s.observe(ctx, id, first, out)
	}()
	return out, func() { cancel(); <-done }, nil
}

func (s activitySource) read(ctx context.Context, id string) (currentActivity, error) {
	var result currentActivity
	run, err := s.store.GetRun(ctx, id)
	if err != nil {
		return result, err
	}
	var record struct {
		State struct {
			Revision     int64
			Version      int64
			Stage        string
			Status       string
			ResumeStatus string
			Figure       struct{ Phase string }
		}
		Issue      json.RawMessage
		IssueKind  string
		ArchivedAt json.RawMessage
	}
	if json.Unmarshal(run.Value, &record) != nil || record.State.Revision < 1 || record.State.Version < 1 {
		return result, errors.New("invalid editorial activity state")
	}
	state := record.State
	effective := state.Status
	if effective == "paused" || effective == "failed" {
		effective = state.ResumeStatus
	}
	stage := stageForActivity(state.Stage, effective, state.Figure.Phase)
	action, err := s.rules.Next(run)
	if err != nil {
		return result, err
	}
	if action.Stage != "" {
		stage = stageForActivity(action.Stage, "", "")
	}
	issue := present(record.Issue) || action.Kind == "requirements_required"
	active := !issue && !present(record.ArchivedAt) && isPendingActivity(state.Status) && action.Kind != ""
	result.base = publicActivity{Revision: state.Revision, Stage: stage, Name: activityName(stage), Active: active, Activity: emptyActivity("queued")}
	result.target.key = activityKey{version: run.Version, revision: state.Revision, stage: stage}
	if !active {
		switch {
		case state.Status == "paused":
			result.base.Phase = "paused"
		case record.IssueKind == "ai_attention":
			result.base.Phase = "permission"
		case issue || state.Status == "failed":
			result.base.Phase = "failed"
		default:
			result.base.Phase = "complete"
		}
		return result, nil
	}
	intent, err := s.pending(ctx, id)
	if errors.Is(err, contract.ErrNotFound) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	result.target.key.parentID = intent.ID
	parentPlan, ok := matchActivityPlan(intent, run.Version, state.Version, stage)
	if !ok {
		return result, nil
	}
	if stage == "figure" && parentPlan.Action.FigureID == "" {
		batch, ok := s.store.(batchActivityReader)
		if !ok {
			return result, nil
		}
		children, err := batch.BatchChildren(ctx, intent.ID)
		if err != nil {
			return result, err
		}
		for _, child := range children {
			if child.Started && child.Result == nil && child.Failure == "" {
				if plan, ok := matchActivityPlan(child.Intent, run.Version, state.Version, stage); ok {
					result.target.attach(child.Intent, plan)
					return result, nil
				}
			}
		}
		return result, nil
	}
	result.target.attach(intent, parentPlan)
	return result, nil
}

func (s activitySource) pending(ctx context.Context, id string) (contract.Intent, error) {
	if indexed, ok := s.store.(pendingRunReader); ok {
		return indexed.PendingRun(ctx, id)
	}
	var current contract.Intent
	found := errors.New("active intent read")
	err := s.store.ScanPending(ctx, func(intent contract.Intent) error {
		if intent.RunID == id {
			current = intent
			return found
		}
		return nil
	})
	switch {
	case errors.Is(err, found):
		return current, nil
	case err != nil:
		return current, err
	default:
		return current, contract.ErrNotFound
	}
}

type activityPlan struct {
	Action    contract.Action
	Version   int64
	MessageID string
}

func matchActivityPlan(intent contract.Intent, version, stateVersion int64, stage string) (activityPlan, bool) {
	var plan activityPlan
	if json.Unmarshal(intent.Action, &plan) != nil || plan.Version != version ||
		plan.Action.StateVersion != stateVersion || plan.Action.Stage != stage {
		return plan, false
	}
	return plan, true
}

func (target *activityTarget) attach(intent contract.Intent, plan activityPlan) {
	ref := intent.Remote
	if ref.AgentID != "" && ref.AgentID != intent.AgentID {
		return
	}
	if plan.MessageID == "" || (ref.TurnID != "" && ref.TurnID != plan.MessageID) ||
		intent.AgentID == "" || ref.After < 0 {
		return
	}
	target.key.childID, target.key.agentID, target.key.messageID = intent.ID, intent.AgentID, plan.MessageID
	ref.AgentID, ref.TurnID = intent.AgentID, plan.MessageID
	// Remote.After is a recovered high-water mark, not the pre-send
	// boundary for this fresh agent. Using it as a boundary hides the turn.
	target.assignment = sessions.Assignment{
		Remote: ref, MessageID: plan.MessageID, Boundary: sessions.Boundary{Epoch: ref.Epoch},
	}
}

func present(value json.RawMessage) bool {
	switch string(bytes.TrimSpace(value)) {
	case "", "null", "false", "\"\"", "0":
		return false
	default:
		return true
	}
}

func isPendingActivity(status string) bool {
	return status == "waiting_ai" || status == "waiting_route" || status == "waiting_figure"
}

var activityNames = map[string]string{
	"diagnose": "진단", "topic": "주제 정리", "audience": "독자 정리", "value": "핵심 정리",
	"research": "근거 정리", "outline": "구성", "draft": "초고 작성", "review": "검토", "route": "수정 위치 확인",
	"figure_plan": "시각자료 위치 제안", "figure_compose": "시각자료 구성", "figure": "시각자료 생성",
}

func stageForActivity(stage, status, phase string) string {
	switch status {
	case "waiting_route":
		return "route"
	case "waiting_figure":
		switch phase {
		case "propose":
			return "figure_plan"
		case "compose":
			return "figure_compose"
		case "generate":
			return "figure"
		}
	}
	if _, ok := activityNames[stage]; ok {
		return stage
	}
	return ""
}

func activityName(stage string) string {
	if label := activityNames[stage]; label != "" {
		return label
	}
	return "현재 작업"
}

func emptyActivity(phase string) sessions.Activity {
	return sessions.Activity{Phase: phase, Steps: []sessions.Step{}}
}

type projectedObservation struct {
	activity sessions.Activity
	epoch    string
	after    int64
	terminal bool
	err      error
}

type liveActivityWatch struct {
	updates chan projectedObservation
	done    chan struct{}
	cancel  context.CancelFunc
}

var errActivityTurnEnded = errors.New("activity turn ended")

func (s activitySource) watch(ctx context.Context, target activityTarget) *liveActivityWatch {
	ctx, cancel := context.WithCancel(ctx)
	watch := &liveActivityWatch{updates: make(chan projectedObservation, 1), done: make(chan struct{}), cancel: cancel}
	go func() {
		defer close(watch.done)
		_ = s.watcher.Watch(ctx, target.assignment.Remote, func(snapshot contract.Snapshot) error {
			if err := ctx.Err(); err != nil {
				return err
			}
			activity, err := sessions.ProjectActivity(snapshot, target.assignment)
			final := err == nil && terminalActivity(snapshot.Status)
			offerLatest(watch.updates, projectedObservation{
				activity: activity, epoch: snapshot.Ref.Epoch, after: snapshot.Ref.After, terminal: final, err: err,
			})
			if final {
				return errActivityTurnEnded
			}
			return nil
		})
	}()
	return watch
}

func terminalActivity(status string) bool {
	switch status {
	case "completed", "failed", "cancelled", "stopped":
		return true
	default:
		return false
	}
}

// Both the remote replay and the HTTP output are single-producer queues. A
// slow browser receives the latest full state without blocking the source.
func offerLatest[T any](channel chan T, value T) {
	select {
	case channel <- value:
		return
	default:
	}
	select {
	case <-channel:
	default:
	}
	channel <- value
}

type activityObserver struct {
	current  currentActivity
	watch    *liveActivityWatch
	last     sessions.Activity
	epoch    string
	minAfter int64
	terminal bool
	lastWire json.RawMessage
	out      chan json.RawMessage
}

func (o *activityObserver) stop() {
	if o.watch != nil {
		o.watch.cancel()
		<-o.watch.done
		o.watch = nil
	}
}

func (o *activityObserver) publish() {
	frame := o.current.base
	if frame.Active {
		frame.Activity = o.last
	}
	encoded, err := json.Marshal(frame)
	if err == nil && !bytes.Equal(encoded, o.lastWire) {
		o.lastWire = encoded
		offerLatest(o.out, json.RawMessage(encoded))
	}
}

func (o *activityObserver) update(ctx context.Context, s activitySource, next currentActivity, start bool) bool {
	same := next.target.key == o.current.target.key
	if !same {
		o.stop()
		o.last = next.base.Activity
		o.epoch = next.target.assignment.Boundary.Epoch
		o.minAfter = next.target.assignment.Remote.After
		o.terminal = false
	}
	o.current = next
	if next.target.assignment.Remote.After > o.minAfter {
		o.minAfter = next.target.assignment.Remote.After
	}
	if start && next.base.Active && next.target.key.agentID != "" && o.watch == nil && !o.terminal {
		o.watch = s.watch(ctx, next.target)
	}
	o.publish()
	return same
}

func (o *activityObserver) sample(sample projectedObservation) {
	switch {
	case sample.epoch != "" && o.epoch != "" && sample.epoch != o.epoch:
		// A replaced timeline invalidates rather than resurrects old text.
		o.last = emptyActivity("unavailable")
	case sample.after < o.minAfter && sample.err == nil:
		// The writer already proved a later cursor.
		return
	case sample.err != nil:
		if sample.epoch != "" && sample.after < o.minAfter {
			return
		}
		o.last.Phase = "unavailable"
	default:
		o.last = sample.activity
		if sample.epoch != "" {
			o.epoch = sample.epoch
		}
		o.minAfter = max(o.minAfter, sample.after)
		o.terminal = sample.terminal
	}
	o.publish()
}

func (s activitySource) observe(ctx context.Context, id string, first currentActivity, out chan json.RawMessage) {
	o := activityObserver{out: out}
	defer o.stop()
	o.update(ctx, s, first, true)
	if !first.base.Active {
		return
	}
	ticks, stopTicker := s.ticks()
	defer stopTicker()

	refresh := func(start bool) (same, alive bool) {
		next, err := s.read(ctx, id)
		switch {
		case ctx.Err() != nil || errors.Is(err, contract.ErrNotFound):
			return false, false
		case err != nil:
			o.stop()
			o.last = emptyActivity("unavailable")
			o.publish()
			return false, true
		default:
			return o.update(ctx, s, next, start), next.base.Active
		}
	}
	for {
		var updates <-chan projectedObservation
		var ended <-chan struct{}
		if o.watch != nil {
			updates, ended = o.watch.updates, o.watch.done
		}
		select {
		case <-ctx.Done():
			return
		case <-ticks:
			if _, alive := refresh(true); !alive {
				return
			}
		case sample := <-updates:
			if same, alive := refresh(true); !alive {
				return
			} else if same {
				o.sample(sample)
			}
		case <-ended:
			if same, alive := refresh(true); !alive {
				return
			} else if !same {
				continue
			}
			select {
			case sample := <-updates:
				o.sample(sample)
			default:
			}
			o.stop()
			if !o.terminal {
				o.last.Phase = "unavailable"
				o.publish()
			}
		}
	}
}
