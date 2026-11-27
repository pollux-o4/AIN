// Package sessions owns role leases, delivery fences, and owned-session cleanup.
package sessions

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

const Source = "ain-go"
const legacySource = "ain-n8n"

var (
	ErrUnavailable = errors.New("no reusable Paseo worker is available")
	ErrOwnership   = errors.New("Paseo worker ownership could not be verified")
)

type Wire interface {
	Snapshot(context.Context, contract.RemoteRef) (contract.Snapshot, error)
	Send(context.Context, contract.RemoteRef, string) error
	SetModel(context.Context, contract.RemoteRef, string) error
	SetThinking(context.Context, contract.RemoteRef, string) error
	Archive(context.Context, contract.RemoteRef) error
}

type Policy struct {
	MaxWarm   int
	WarmIdle  time.Duration
	Grace     time.Duration
	RetryBase time.Duration
	RetryMax  time.Duration
}

func DefaultPolicy() Policy {
	return Policy{MaxWarm: 6, WarmIdle: 15 * time.Minute, Grace: 2 * time.Minute,
		RetryBase: time.Minute, RetryMax: 15 * time.Minute}
}

type Config struct {
	Owner          string
	LegacyOwner    string
	ReuseProviders []string
	Policy         Policy
	Now            func() time.Time
}

type Manager struct {
	registry *Registry
	wire     Wire
	cfg      Config
	inFlight sync.Map
}

func New(registry *Registry, wire Wire, cfg Config) (*Manager, error) {
	if registry == nil || wire == nil || !sameOwner(cfg.Owner) ||
		(cfg.LegacyOwner != "" && !sameOwner(cfg.LegacyOwner)) {
		return nil, errors.New("verified absolute session ownership and both ports are required")
	}
	if cfg.Policy == (Policy{}) {
		cfg.Policy = DefaultPolicy()
	}
	if cfg.Policy.MaxWarm < 0 || cfg.Policy.WarmIdle <= 0 || cfg.Policy.Grace < 0 ||
		cfg.Policy.RetryBase <= 0 || cfg.Policy.RetryMax < cfg.Policy.RetryBase {
		return nil, errors.New("invalid session lifetime limits")
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.ReuseProviders == nil {
		cfg.ReuseProviders = []string{"antigravity"}
	}
	cfg.ReuseProviders = slices.Clone(cfg.ReuseProviders)
	return &Manager{registry: registry, wire: wire, cfg: cfg}, nil
}

func (m *Manager) Labels(jobID string) map[string]string {
	return map[string]string{"source": Source, "owner": m.cfg.Owner, "job": jobID}
}

type Lease struct{ worker Worker }

func (l Lease) AgentID() string              { return l.worker.AgentID }
func (l Lease) Delivered() map[string]string { return maps.Clone(l.worker.Delivered) }

type Assignment struct {
	Remote    contract.RemoteRef
	Boundary  Boundary
	MessageID string
}

func (l Lease) Assignment() Assignment {
	boundary := l.worker.Boundary
	boundary.Usage = maps.Clone(boundary.Usage)
	return Assignment{
		Remote:   contract.RemoteRef{AgentID: l.worker.AgentID, Epoch: boundary.Epoch, After: boundary.After},
		Boundary: boundary, MessageID: l.worker.MessageID,
	}
}

// TrackFresh runs after the caller reserves the intent and before creating an
// agent with Labels. The originating job remains part of the ownership proof.
func (m *Manager) TrackFresh(ctx context.Context, key Key, jobID, agentID, messageID, provider string) (Lease, error) {
	if !validKey(key) || jobID == "" || agentID == "" || messageID == "" || provider == "" {
		return Lease{}, errors.New("invalid fresh session assignment")
	}
	worker, err := m.registry.save(ctx, Worker{
		Key: key, AgentID: agentID, JobID: jobID, OriginJob: jobID, MessageID: messageID,
		Provider: provider, Source: Source, Owner: m.cfg.Owner, Phase: active, ChangedAt: m.cfg.Now(),
	})
	return Lease{worker}, err
}

// Recover reloads a lease by its exact persisted agent and job identity. It
// does not create or send anything. In-flight assignments remain live across
// shutdown if the editorial store still includes their agent in active work.
func (m *Manager) Recover(ctx context.Context, agentID, jobID string) (Lease, error) {
	worker, err := m.registry.get(ctx, agentID)
	if err != nil {
		return Lease{}, err
	}
	if worker.JobID != jobID || !slices.Contains([]Phase{active, claimed, sending}, worker.Phase) || !m.owns(worker) {
		return Lease{}, contract.ErrConflict
	}
	return Lease{worker}, nil
}

func (m *Manager) Acquire(ctx context.Context, key Key, jobID, messageID string, desired contract.SessionSpec) (Lease, error) {
	if !validKey(key) || jobID == "" || messageID == "" || jobID == messageID {
		return Lease{}, errors.New("invalid reused session assignment")
	}
	if m.cfg.Policy.MaxWarm == 0 || !slices.Contains(m.cfg.ReuseProviders, desired.Provider) {
		return Lease{}, ErrUnavailable
	}
	workers, err := m.registry.List(ctx)
	if err != nil {
		return Lease{}, err
	}
	sortNewest(workers)
	for _, worker := range workers {
		if worker.Phase != warm || worker.Key != key || worker.Provider != desired.Provider ||
			worker.MessageID == messageID || !m.owns(worker) || m.cfg.Now().Sub(worker.ChangedAt) >= m.cfg.Policy.WarmIdle {
			continue
		}
		agent, boundary, err := m.inspect(ctx, worker)
		if ctx.Err() != nil {
			return Lease{}, ctx.Err()
		}
		if err != nil || !compatible(agent, boundary, worker.Boundary, desired) {
			continue
		}
		worker.Phase, worker.JobID, worker.MessageID, worker.ChangedAt = claimed, jobID, messageID, m.cfg.Now()
		worker.Boundary = boundary
		if worker, err = m.registry.save(ctx, worker); err == nil {
			return Lease{worker}, nil
		}
		if !errors.Is(err, contract.ErrConflict) {
			return Lease{}, err
		}
	}
	return Lease{}, ErrUnavailable
}

// Dispatch claims the sole delivery attempt. The persist callback binds the
// assignment to the editorial intent before any remote mutation. On failure
// after binding, callers reconcile from the saved identity without replay.
func (m *Manager) Dispatch(ctx context.Context, lease Lease, desired contract.SessionSpec, persist func(context.Context, Assignment) error) error {
	worker := lease.worker
	if worker.Phase != claimed || !m.owns(worker) || desired.Provider != worker.Provider ||
		desired.Model == "" || strings.TrimSpace(desired.Prompt) == "" || persist == nil {
		return errors.New("invalid reused session dispatch")
	}
	if _, busy := m.inFlight.LoadOrStore(worker.AgentID, struct{}{}); busy {
		return contract.ErrConflict
	}
	defer m.inFlight.Delete(worker.AgentID)
	agent, boundary, err := m.inspect(ctx, worker)
	if err != nil {
		return err
	}
	if !compatible(agent, boundary, worker.Boundary, desired) {
		return ErrUnavailable
	}
	worker.Phase, worker.ChangedAt = sending, m.cfg.Now()
	worker, err = m.registry.save(ctx, worker)
	if err != nil {
		return err
	}
	assignment := (Lease{worker}).Assignment()
	if err := persist(ctx, assignment); err != nil {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), time.Second)
		defer cancel()
		worker.Phase, worker.ChangedAt = retired, m.cfg.Now()
		_, cleanupErr := m.registry.save(cleanup, worker)
		return errors.Join(err, cleanupErr)
	}
	ref := assignment.Remote
	ref.TurnID = worker.MessageID
	if agent.Model != desired.Model {
		if err := m.wire.SetModel(ctx, ref, desired.Model); err != nil {
			return errors.Join(contract.ErrDeliveryUncertain, err)
		}
	}
	if desired.Thinking != "" && desired.Thinking != agent.Thinking {
		if err := m.wire.SetThinking(ctx, ref, desired.Thinking); err != nil {
			return errors.Join(contract.ErrDeliveryUncertain, err)
		}
	}
	agent, boundary, err = m.inspect(ctx, worker)
	if err != nil || !compatible(agent, boundary, worker.Boundary, desired) ||
		agent.Model != desired.Model || (desired.Thinking != "" && agent.Thinking != desired.Thinking) {
		return errors.Join(contract.ErrDeliveryUncertain, err)
	}
	if err := m.wire.Send(ctx, ref, desired.Prompt); err != nil {
		return errors.Join(contract.ErrDeliveryUncertain, err)
	}
	return nil
}

// ProvesResult accepts only the exact client message, in the observed epoch,
// after the old native turn and cursor. Fresh jobs have no baseline.
func (l Lease) ProvesResult(snapshot contract.Snapshot) bool {
	return l.Assignment().ProvesResult(snapshot)
}

// ProvesResult also works from the assignment saved with the editorial intent
// when the registry lease cannot be loaded after a restart.
func (a Assignment) ProvesResult(snapshot contract.Snapshot) bool {
	ref := snapshot.Ref
	if ref.AgentID != a.Remote.AgentID || ref.TurnID == "" || ref.TurnID != a.MessageID ||
		ref.Epoch == "" || ref.After <= a.Boundary.After ||
		(a.Boundary.Epoch != "" && ref.Epoch != a.Boundary.Epoch) {
		return false
	}
	if !slices.Contains([]string{"completed", "failed", "cancelled", "stopped"}, snapshot.Status) {
		return false
	}
	var result struct{ DaemonTurnID string }
	return json.Unmarshal(snapshot.Body, &result) == nil && result.DaemonTurnID != "" &&
		result.DaemonTurnID != a.Boundary.DaemonTurnID
}

// Release runs after the result was durably applied. A rejected/failed session
// is retired. For a reusable success, inspect its current boundary before
// making it available to the next job in the same role.
func (m *Manager) Release(ctx context.Context, lease Lease, result contract.Snapshot, delivered map[string]string, keep bool) error {
	if !lease.ProvesResult(result) {
		return contract.ErrDeliveryUncertain
	}
	worker, err := m.registry.get(ctx, lease.AgentID())
	if err != nil {
		return err
	}
	if worker.JobID != lease.worker.JobID || worker.MessageID != lease.worker.MessageID || !m.owns(worker) {
		return contract.ErrConflict
	}
	if worker.Phase == warm || worker.Phase == retired {
		return nil
	}
	if worker.Phase != active && worker.Phase != sending {
		return contract.ErrConflict
	}
	worker.Phase, worker.ChangedAt = retired, m.cfg.Now()
	if keep && result.Status == "completed" && m.cfg.Policy.MaxWarm > 0 &&
		slices.Contains(m.cfg.ReuseProviders, worker.Provider) {
		agent, current, err := m.inspect(ctx, worker)
		var terminal struct{ DaemonTurnID string }
		_ = json.Unmarshal(result.Body, &terminal)
		if err == nil && idle(agent) && current.Epoch == result.Ref.Epoch &&
			current.After >= result.Ref.After && current.DaemonTurnID == terminal.DaemonTurnID {
			worker.Phase, worker.Boundary = warm, current
			worker.Delivered = maps.Clone(delivered)
		}
	}
	_, err = m.registry.save(ctx, worker)
	return err
}

// Abandon releases a claim that never reached Dispatch. Attempted deliveries
// remain protected by the durable editorial intent until reconciled.
func (m *Manager) Abandon(ctx context.Context, lease Lease) error {
	worker := lease.worker
	if worker.Phase != claimed || !m.owns(worker) {
		return contract.ErrConflict
	}
	worker.Phase, worker.ChangedAt = retired, m.cfg.Now()
	_, err := m.registry.save(ctx, worker)
	return err
}

func validKey(key Key) bool { return key.ArticleID != "" && key.Role != "" }

func (m *Manager) owns(worker Worker) bool {
	return worker.Source == Source && worker.Owner == m.cfg.Owner ||
		worker.Source == legacySource && m.cfg.LegacyOwner != "" && worker.Owner == m.cfg.LegacyOwner
}
