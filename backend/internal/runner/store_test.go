package runner

import (
	"context"
	"encoding/json"
	"sync"
	"sync/atomic"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

type testStore struct {
	contract.Store
	mu          sync.Mutex
	ids         []string
	runs        map[string]contract.Run
	pending     map[string]contract.Intent
	applied     map[string]bool
	committed   chan contract.Run
	commitCount atomic.Int32
}

func newTestStore(ids ...string) *testStore {
	s := &testStore{
		ids: ids, runs: make(map[string]contract.Run), pending: make(map[string]contract.Intent),
		applied: make(map[string]bool), committed: make(chan contract.Run, len(ids)),
	}
	for _, id := range ids {
		s.runs[id] = contract.Run{ID: id, RequestID: id, Version: 1, Value: json.RawMessage(`"ready"`)}
	}
	return s
}

func (s *testStore) GetRun(ctx context.Context, id string) (contract.Run, error) {
	if err := ctx.Err(); err != nil {
		return contract.Run{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	run, ok := s.runs[id]
	if !ok {
		return contract.Run{}, contract.ErrNotFound
	}
	return run, nil
}

func (s *testStore) ListSummaries(ctx context.Context, visit func(contract.RunSummary) error) error {
	for _, id := range s.ids {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := visit(contract.RunSummary{ID: id}); err != nil {
			return err
		}
	}
	return nil
}

func (s *testStore) ScanPending(ctx context.Context, visit func(contract.Intent) error) error {
	s.mu.Lock()
	intents := make([]contract.Intent, 0, len(s.pending))
	for _, intent := range s.pending {
		intents = append(intents, intent)
	}
	s.mu.Unlock()
	for _, intent := range intents {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := visit(intent); err != nil {
			return err
		}
	}
	return nil
}

func (s *testStore) currentIntent(runID string) (contract.Intent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	intent, ok := s.pending[runID]
	if !ok {
		return contract.Intent{}, contract.ErrNotFound
	}
	return intent, nil
}

func (s *testStore) Reserve(ctx context.Context, version int64, run contract.Run, intent contract.Intent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if s.pending[run.ID].ID != "" || s.applied[intent.ID] || s.runs[run.ID].Version != version {
		return contract.ErrConflict
	}
	s.pending[run.ID] = intent
	s.runs[run.ID] = run
	return nil
}

func (s *testStore) Bind(ctx context.Context, id string, ref contract.RemoteRef) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	for runID, intent := range s.pending {
		if intent.ID == id {
			intent.Remote = ref
			s.pending[runID] = intent
			return nil
		}
	}
	return contract.ErrNotFound
}

func (s *testStore) UpdateRun(ctx context.Context, version int64, run contract.Run) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if s.runs[run.ID].Version != version {
		return contract.ErrConflict
	}
	s.runs[run.ID] = run
	return nil
}

func (s *testStore) Commit(ctx context.Context, version int64, id string, run contract.Run) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if s.pending[run.ID].ID != id || s.applied[id] || s.runs[run.ID].Version != version {
		return contract.ErrConflict
	}
	s.runs[run.ID] = run
	s.applied[id] = true
	delete(s.pending, run.ID)
	s.commitCount.Add(1)
	s.committed <- run
	return nil
}
