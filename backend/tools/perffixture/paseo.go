package main

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"runtime"
	"sync"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

type simulatedSession struct {
	labels            map[string]string
	reply             json.RawMessage
	ready             chan struct{}
	timing            timing
	stopped, archived bool
}

type syntheticPaseo struct {
	mu            sync.Mutex
	config        config
	agents        map[string]*simulatedSession
	assigned      map[string]assignedTurn
	jobs          map[string][]string
	finished      map[string]timing
	dispatched    map[string]bool
	pulse         chan struct{}
	lastError     error
	subscriptions int
}

func newSyntheticPaseo(cfg config) *syntheticPaseo {
	return &syntheticPaseo{
		config: cfg, agents: map[string]*simulatedSession{}, assigned: map[string]assignedTurn{},
		jobs: map[string][]string{}, finished: map[string]timing{}, dispatched: map[string]bool{},
		pulse: make(chan struct{}, 1),
	}
}

var _ contract.Paseo = (*syntheticPaseo)(nil)

func (*syntheticPaseo) Probe(context.Context) (json.RawMessage, error) {
	return json.RawMessage(`{"version":"synthetic"}`), nil
}

func (p *syntheticPaseo) Create(ctx context.Context, id string, spec contract.SessionSpec) (contract.RemoteRef, error) {
	if err := ctx.Err(); err != nil {
		return contract.RemoteRef{}, err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	turn, ok := p.assigned[id]
	if !ok || spec.Provider != "fixture" || spec.Model != "fixture-model" || spec.Prompt == "" || p.agents[id] != nil {
		return contract.RemoteRef{}, errors.New("unexpected synthetic remote create")
	}
	key := turn.stage
	if turn.figure != "" {
		key += "/" + turn.figure
	}
	reply := p.config.Replies[key]
	if !json.Valid(reply) {
		return contract.RemoteRef{}, errors.New("missing synthetic response for " + key)
	}
	agent := &simulatedSession{labels: maps.Clone(spec.Labels), reply: reply, ready: make(chan struct{})}
	p.agents[id] = agent
	if turn.stage == "diagnose" {
		p.dispatched[turn.runID] = true
		select {
		case p.pulse <- struct{}{}:
		default:
		}
	}
	time.AfterFunc(time.Duration(p.config.CompletionDelayMs)*time.Millisecond, func() {
		p.mu.Lock()
		defer p.mu.Unlock()
		if !agent.stopped {
			agent.timing.Signal = epochMS()
			close(agent.ready)
		}
	})
	return contract.RemoteRef{AgentID: id, TurnID: id}, nil
}

func (p *syntheticPaseo) Snapshot(ctx context.Context, ref contract.RemoteRef) (contract.Snapshot, error) {
	if err := ctx.Err(); err != nil {
		return contract.Snapshot{}, err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	agent := p.agents[ref.AgentID]
	if agent == nil {
		return contract.Snapshot{}, contract.ErrNotFound
	}
	cursor := contract.RemoteRef{AgentID: ref.AgentID, Epoch: "fixture-epoch", After: 1}
	if ref.TurnID == ref.AgentID {
		cursor.TurnID = ref.TurnID
		switch {
		case agent.stopped:
			return contract.Snapshot{Ref: cursor, Status: "stopped"}, nil
		case agent.timing.Signal != 0:
			if agent.timing.Checked == 0 {
				agent.timing.Checked = epochMS()
			}
			cursor.After = 2
			body, err := json.Marshal(map[string]string{"daemonTurnId": ref.AgentID, "text": string(agent.reply)})
			return contract.Snapshot{Ref: cursor, Status: "completed", Body: body}, err
		}
	}
	state := "running"
	if agent.timing.Signal > 0 || agent.stopped {
		state = "idle"
		cursor.After = 2
	}
	remote := map[string]any{"id": ref.AgentID, "provider": "fixture", "model": "fixture-model", "status": state,
		"labels": agent.labels, "activeTurn": nil}
	if agent.archived {
		remote["archivedAt"] = "2026-01-01T00:00:00Z"
	}
	body, err := json.Marshal(map[string]any{"agent": remote, "entries": []map[string]any{
		{"turnId": ref.AgentID, "seqStart": 1, "seqEnd": 1, "item": map[string]string{"type": "user_message", "clientMessageId": ref.AgentID}},
	}})
	return contract.Snapshot{Ref: cursor, Status: state, Body: body}, err
}

func (p *syntheticPaseo) Watch(ctx context.Context, ref contract.RemoteRef, emit func(contract.Snapshot) error) error {
	p.mu.Lock()
	agent := p.agents[ref.AgentID]
	if agent == nil {
		p.mu.Unlock()
		return contract.ErrNotFound
	}
	p.subscriptions++
	p.mu.Unlock()
	defer func() { p.mu.Lock(); p.subscriptions--; p.mu.Unlock() }()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-agent.ready:
	}
	if err := emit(contract.Snapshot{Ref: ref}); err != nil {
		return err
	}
	<-ctx.Done()
	return ctx.Err()
}

func (p *syntheticPaseo) Cancel(_ context.Context, ref contract.RemoteRef) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	agent := p.agents[ref.AgentID]
	if agent == nil {
		return contract.ErrNotFound
	}
	if !agent.stopped && agent.timing.Signal == 0 {
		agent.stopped = true
		close(agent.ready)
	}
	return nil
}

func (p *syntheticPaseo) Archive(_ context.Context, ref contract.RemoteRef) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	agent := p.agents[ref.AgentID]
	if agent == nil {
		return contract.ErrNotFound
	}
	if !agent.stopped && agent.timing.Signal == 0 {
		return errors.New("synthetic running session cannot be archived")
	}
	agent.archived = true
	return nil
}

func (*syntheticPaseo) Send(context.Context, contract.RemoteRef, string) error {
	return errors.New("fixture provider must not be reused")
}

func (*syntheticPaseo) SetModel(context.Context, contract.RemoteRef, string) error {
	return errors.New("fixture provider model cannot change")
}

func (*syntheticPaseo) SetThinking(context.Context, contract.RemoteRef, string) error {
	return errors.New("fixture provider thinking cannot change")
}

func (p *syntheticPaseo) counts() map[string]int {
	p.mu.Lock()
	defer p.mu.Unlock()
	result := map[string]int{"goroutines": runtime.NumGoroutine(), "subscriptions": p.subscriptions, "runningSessions": 0, "idleSessions": 0}
	for _, agent := range p.agents {
		if agent.archived {
			continue
		}
		if agent.stopped || agent.timing.Signal != 0 {
			result["idleSessions"]++
		} else {
			result["runningSessions"]++
		}
	}
	return result
}

func (p *syntheticPaseo) traces() map[string]timing {
	p.mu.Lock()
	defer p.mu.Unlock()
	return maps.Clone(p.finished)
}

func (p *syntheticPaseo) noteError(err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.lastError = err
}

func (p *syntheticPaseo) awaitDispatch(ctx context.Context, ids []string) error {
	for {
		p.mu.Lock()
		all := true
		for _, id := range ids {
			all = all && p.dispatched[id]
		}
		p.mu.Unlock()
		if all {
			return nil
		}
		select {
		case <-ctx.Done():
			p.mu.Lock()
			err := p.lastError
			p.mu.Unlock()
			return errors.Join(ctx.Err(), err)
		case <-p.pulse:
		}
	}
}
