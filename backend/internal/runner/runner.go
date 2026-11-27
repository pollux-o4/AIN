package runner

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

type Config struct {
	Workers         int
	Queue           int
	TurnLimit       time.Duration
	RecheckInterval time.Duration
	MaxRechecks     int
	Now             func() time.Time
	After           func(time.Duration) <-chan time.Time
	// Reserve applies reservation state, including the budget change, without I/O.
	Reserve func(contract.Run, contract.Action) (contract.Run, error)
	// Paused applies a confirmed pause and may retain a result that raced with cancellation.
	Paused  func(contract.Run, *contract.Event) (contract.Run, error)
	OnError func(runID string, err error)
}

type Runner struct {
	store contract.Store
	paseo contract.Paseo
	rules contract.EditorialRules
	turns contract.TurnBuilder
	cfg   Config

	reserve  sync.Mutex
	mu       sync.Mutex
	started  bool
	slots    map[string]*slot
	pausing  map[string]bool
	queue    chan *slot
	recover  chan struct{}
	capacity chan struct{}
}

type slot struct {
	id        string
	intent    *contract.Intent
	candidate bool
	cancel    context.CancelFunc
	done      chan struct{}
	again     bool
}

var _ contract.Scheduler = (*Runner)(nil)

func New(store contract.Store, paseo contract.Paseo, rules contract.EditorialRules, turns contract.TurnBuilder, cfg Config) (*Runner, error) {
	if store == nil || paseo == nil || rules == nil || turns == nil || cfg.Reserve == nil || cfg.Paused == nil {
		return nil, errors.New("runner ports and transition policies are required")
	}
	if cfg.Workers <= 0 || cfg.Queue <= 0 || cfg.TurnLimit <= 0 ||
		cfg.RecheckInterval <= 0 || cfg.MaxRechecks <= 0 {
		return nil, errors.New("runner resource and recheck limits must be positive")
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.After == nil {
		cfg.After = time.After
	}
	return &Runner{
		store: store, paseo: paseo, rules: rules, turns: turns, cfg: cfg,
		slots: make(map[string]*slot), pausing: make(map[string]bool),
		queue: make(chan *slot, cfg.Queue), recover: make(chan struct{}, 1), capacity: make(chan struct{}, 1),
	}, nil
}

// Run starts the process-owned workers and waits for all local watches to exit.
func (r *Runner) Run(ctx context.Context) error {
	r.mu.Lock()
	if r.started {
		r.mu.Unlock()
		return errors.New("runner already started")
	}
	r.started = true
	r.mu.Unlock()

	var workers sync.WaitGroup
	for range r.cfg.Workers {
		workers.Go(func() { r.work(ctx) })
	}
	r.requestRecovery()
scan:
	for {
		select {
		case <-ctx.Done():
			break scan
		case <-r.recover:
			r.report("", r.recoverRuns(ctx))
		}
	}
	workers.Wait()
	return nil
}

func (r *Runner) Wake(runID string) {
	if runID != "" && !r.enqueue(runID, nil, false) {
		r.requestRecovery()
	}
}

// Recover schedules reconciliation of durable work. It can be called before Run.
func (r *Runner) Recover(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	r.requestRecovery()
	return nil
}

func (r *Runner) requestRecovery() {
	select {
	case r.recover <- struct{}{}:
	default:
	}
}

func (r *Runner) enqueue(id string, intent *contract.Intent, candidate bool) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.pausing[id] {
		return true
	}
	if queued := r.slots[id]; queued != nil {
		if queued.cancel == nil && (intent != nil || !candidate) {
			queued.intent, queued.candidate = intent, candidate
		} else if !candidate && intent == nil {
			queued.again = true
		}
		return true
	}
	next := &slot{id: id, intent: intent, candidate: candidate, done: make(chan struct{})}
	select {
	case r.queue <- next:
		r.slots[id] = next
		return true
	default:
		return false
	}
}

func (r *Runner) recoverRuns(ctx context.Context) error {
	admit := func(id string, intent *contract.Intent, candidate bool) error {
		for !r.enqueue(id, intent, candidate) {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-r.capacity:
			}
		}
		return ctx.Err()
	}
	if err := r.store.ScanPending(ctx, func(intent contract.Intent) error {
		return admit(intent.RunID, &intent, false)
	}); err != nil {
		return err
	}
	return r.store.ListSummaries(ctx, func(summary contract.RunSummary) error {
		if summary.Archived {
			return nil
		}
		return admit(summary.ID, nil, true)
	})
}

func (r *Runner) work(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case next := <-r.queue:
			select {
			case r.capacity <- struct{}{}:
			default:
			}
			r.runSlot(ctx, next)
		}
	}
}

func (r *Runner) runSlot(parent context.Context, next *slot) {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	r.mu.Lock()
	next.cancel = cancel
	if r.pausing[next.id] {
		cancel()
	}
	// From this point admission may update only again.
	intent, candidate := next.intent, next.candidate
	r.mu.Unlock()

	advance, err := false, ctx.Err()
	if err == nil {
		advance, err = r.process(ctx, next.id, intent, candidate)
	}
	r.mu.Lock()
	delete(r.slots, next.id)
	close(next.done)
	again := (next.again || advance) && !r.pausing[next.id]
	r.mu.Unlock()
	r.report(next.id, err)
	if again && parent.Err() == nil {
		r.Wake(next.id)
	}
}

func (r *Runner) report(id string, err error) {
	if r.cfg.OnError == nil || err == nil || errors.Is(err, context.Canceled) {
		return
	}
	if errors.Is(err, contract.ErrDeliveryUncertain) ||
		(!errors.Is(err, contract.ErrConflict) && !errors.Is(err, contract.ErrNotFound)) {
		r.cfg.OnError(id, err)
	}
}
