package sessions

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

// LegacyWorker pairs an existing role binding with a legacy job that links the
// same agent. Import callers obtain both identities from the protected store.
type LegacyWorker struct {
	Key           Key
	WorkerAgentID string
	JobAgentID    string
	JobID         string
	Provider      string
	UpdatedAt     time.Time
	Delivered     map[string]string
}

func (m *Manager) ImportLegacy(ctx context.Context, record LegacyWorker) error {
	if m.cfg.LegacyOwner == "" || !validKey(record.Key) || record.WorkerAgentID == "" ||
		record.WorkerAgentID != record.JobAgentID || record.JobID == "" || record.Provider == "" ||
		record.UpdatedAt.IsZero() || record.UpdatedAt.After(m.cfg.Now()) {
		return ErrOwnership
	}
	worker := Worker{
		Key: record.Key, AgentID: record.WorkerAgentID, JobID: record.JobID, OriginJob: record.JobID,
		Source: legacySource, Owner: m.cfg.LegacyOwner, Provider: record.Provider,
		Phase: warm, ChangedAt: record.UpdatedAt, Delivered: record.Delivered,
	}
	agent, boundary, err := m.inspect(ctx, worker)
	if err != nil {
		return err
	}
	if !idle(agent) || boundary.DaemonTurnID == "" {
		return ErrUnavailable
	}
	worker.Boundary = boundary
	_, err = m.registry.save(ctx, worker)
	return err
}

type SweepResult struct {
	Warm     int
	Archived int
	Deferred int
	Foreign  int
}

// Sweep trims the role cache and archives only known, owned, quiescent
// agents outside the supplied durable active set. Call all on shutdown after
// stopping admission. Archive failures are retried with bounded backoff.
func (m *Manager) Sweep(ctx context.Context, isActive func(context.Context, string) (bool, error), all bool) (SweepResult, error) {
	if isActive == nil {
		return SweepResult{}, errors.New("durable active-work check is required")
	}
	workers, err := m.registry.List(ctx)
	if err != nil {
		return SweepResult{}, err
	}
	sortNewest(workers)
	now := m.cfg.Now()
	var result SweepResult
	kept := map[Key]bool{}
	for _, worker := range workers {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		if !m.owns(worker) {
			result.Foreign++
			continue
		}
		if _, busy := m.inFlight.Load(worker.AgentID); busy {
			continue
		}
		isLive, err := isActive(ctx, worker.AgentID)
		if err != nil {
			return result, err
		}
		if isLive {
			continue
		}
		if worker.Phase == warm {
			if !all && !kept[worker.Key] && result.Warm < m.cfg.Policy.MaxWarm &&
				now.Sub(worker.ChangedAt) < m.cfg.Policy.WarmIdle {
				kept[worker.Key] = true
				result.Warm++
				continue
			}
			worker.Phase = retired
			worker, err = m.registry.save(ctx, worker)
			if err != nil {
				if errors.Is(err, contract.ErrConflict) {
					continue
				}
				return result, err
			}
		}
		if now.Before(worker.RetryAt) || (!all && now.Sub(worker.ChangedAt) < m.cfg.Policy.Grace) {
			result.Deferred++
			continue
		}
		if err := m.archive(ctx, worker, now, &result); err != nil && !errors.Is(err, contract.ErrConflict) {
			return result, err
		}
	}
	return result, nil
}

func (m *Manager) archive(ctx context.Context, worker Worker, now time.Time, result *SweepResult) error {
	worker.Phase, worker.RetryAt = archiving, now.Add(m.cfg.Policy.RetryBase)
	worker, err := m.registry.save(ctx, worker)
	if err != nil {
		return err
	}
	agent, _, err := m.inspect(ctx, worker)
	switch {
	case errors.Is(err, ErrOwnership):
		result.Foreign++
		return m.registry.remove(ctx, worker)
	case errors.Is(err, contract.ErrNotFound):
		return m.registry.remove(ctx, worker)
	case err == nil && agent.ArchivedAt != "":
		return m.registry.remove(ctx, worker)
	case err == nil && closed(agent):
		err = m.wire.Archive(ctx, contract.RemoteRef{AgentID: worker.AgentID})
		if err == nil {
			result.Archived++
			return m.registry.remove(ctx, worker)
		}
	}
	result.Deferred++
	worker.Phase = retired
	if err != nil {
		worker.Attempts++
		worker.RetryAt = now.Add(m.backoff(worker.Attempts))
	}
	_, err = m.registry.save(ctx, worker)
	return err
}

func (m *Manager) backoff(attempts int) time.Duration {
	delay := m.cfg.Policy.RetryBase
	for i := 1; i < attempts && delay < m.cfg.Policy.RetryMax; i++ {
		delay += min(delay, m.cfg.Policy.RetryMax-delay)
	}
	return delay
}

func sortNewest(workers []Worker) {
	slices.SortFunc(workers, func(left, right Worker) int {
		if time := right.ChangedAt.Compare(left.ChangedAt); time != 0 {
			return time
		}
		return strings.Compare(left.AgentID, right.AgentID)
	})
}
