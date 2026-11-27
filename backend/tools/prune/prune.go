package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/pollux-o4/AIN/backend/internal/datalock"
	"github.com/pollux-o4/AIN/backend/internal/sessions"
	"github.com/pollux-o4/AIN/backend/internal/store"
)

type pruneWire interface {
	sessions.Wire
	Probe(context.Context) (json.RawMessage, error)
}

func prune(ctx context.Context, data string, wire pruneWire, all bool) (sessions.SweepResult, error) {
	root, err := filepath.Abs(data)
	if err != nil {
		return sessions.SweepResult{}, err
	}
	path := filepath.Join(root, "editorial.sqlite")
	if _, err := os.Lstat(path); err != nil {
		return sessions.SweepResult{}, fmt.Errorf("existing Go editorial database required: %w", err)
	}
	lock, err := datalock.Acquire(root)
	if err != nil {
		return sessions.SweepResult{}, err
	}
	defer lock.Close()
	if err := store.RequireExistingRuntimeSchema(ctx, path); err != nil {
		return sessions.SweepResult{}, err
	}
	if _, err := wire.Probe(ctx); err != nil {
		return sessions.SweepResult{}, fmt.Errorf("connect to local Paseo daemon: %w", err)
	}
	db, err := store.Open(ctx, path)
	if err != nil {
		return sessions.SweepResult{}, err
	}
	defer db.Close()
	registry, err := db.SessionRegistry(ctx)
	if err != nil {
		return sessions.SweepResult{}, err
	}
	// shortcut: 이전 런타임의 세션은 Go 소유권과 활성 작업을 함께 입증할 수 없어 보존, 이전 세션 이관을 지원할 때 재검토.
	manager, err := sessions.New(registry, wire, sessions.Config{Owner: root})
	if err != nil {
		return sessions.SweepResult{}, err
	}
	return manager.Sweep(ctx, db.IsAgentActive, all)
}
