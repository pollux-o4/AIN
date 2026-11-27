package main

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/store"
)

func epochMS() float64 { return float64(time.Now().UnixNano()) / 1e6 }

type tracedStore struct {
	*store.SQLite
	paseo   *syntheticPaseo
	visible sync.RWMutex
}

type timing struct {
	Signal  float64 `json:"signal"`
	Checked float64 `json:"checked"`
	Saved   float64 `json:"saved"`
}

func (s *tracedStore) GetRun(ctx context.Context, id string) (contract.Run, error) {
	s.visible.RLock()
	defer s.visible.RUnlock()
	return s.SQLite.GetRun(ctx, id)
}

func (s *tracedStore) Commit(ctx context.Context, version int64, id string, run contract.Run) error {
	// Match the Node save boundary: an API reader cannot observe the new
	// state until the timestamp from the SQLite return is recorded.
	s.visible.Lock()
	defer s.visible.Unlock()
	if err := s.SQLite.Commit(ctx, version, id, run); err != nil {
		return err
	}
	s.paseo.markSaved(id)
	return nil
}

func (s *tracedStore) ReserveWithinLimit(ctx context.Context, version int64, run contract.Run, intent contract.Intent, limit int) (bool, error) {
	reserved, err := s.SQLite.ReserveWithinLimit(ctx, version, run, intent, limit)
	if reserved && err == nil {
		s.paseo.remember(intent.ID, []contract.Intent{intent})
	}
	return reserved, err
}

func (s *tracedStore) ReserveBatch(ctx context.Context, version int64, run contract.Run, parent contract.Intent, children []contract.Intent) error {
	if err := s.SQLite.ReserveBatch(ctx, version, run, parent, children); err != nil {
		return err
	}
	s.paseo.remember(parent.ID, children)
	return nil
}

func (s *tracedStore) activeAgent(ctx context.Context, agent string) (bool, error) {
	matched := errors.New("matching active session")
	err := s.ScanPending(ctx, func(intent contract.Intent) error {
		if intent.AgentID == agent || intent.Remote.AgentID == agent {
			return matched
		}
		if intent.AgentID != "" {
			return nil
		}
		children, err := s.BatchChildren(ctx, intent.ID)
		if err != nil {
			return err
		}
		for _, child := range children {
			if child.Started && child.Result == nil && child.Failure == "" && (child.AgentID == agent || child.Remote.AgentID == agent) {
				return matched
			}
		}
		return nil
	})
	if errors.Is(err, matched) {
		return true, nil
	}
	return false, err
}

type assignedTurn struct {
	runID, stage, figure string
}

func (p *syntheticPaseo) remember(parent string, children []contract.Intent) {
	p.mu.Lock()
	defer p.mu.Unlock()
	agents := make([]string, 0, len(children))
	for _, child := range children {
		var plan struct{ Action contract.Action }
		if json.Unmarshal(child.Action, &plan) != nil {
			continue
		}
		agents = append(agents, child.AgentID)
		p.assigned[child.AgentID] = assignedTurn{runID: child.RunID, stage: plan.Action.Stage, figure: plan.Action.FigureID}
	}
	p.jobs[parent] = agents
}

func (p *syntheticPaseo) markSaved(id string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	agents := p.jobs[id]
	if len(agents) == 0 {
		return
	}
	value := timing{Saved: epochMS()}
	for _, agentID := range agents {
		agent := p.agents[agentID]
		if agent == nil || agent.timing.Checked == 0 || agent.timing.Signal == 0 {
			return
		}
		value.Signal = max(value.Signal, agent.timing.Signal)
		value.Checked = max(value.Checked, agent.timing.Checked)
	}
	p.finished[id] = value
}
