package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/datalock"
	"github.com/pollux-o4/AIN/backend/internal/figuredomain"
	"github.com/pollux-o4/AIN/backend/internal/store"
	"github.com/pollux-o4/AIN/backend/internal/writing"
)

type object = map[string]any

type provenance struct {
	Variant  string `json:"variant"`
	Provider string `json:"provider"`
	Model    string `json:"model"`
	Thinking string `json:"thinking"`
}

func seed(ctx context.Context, source, data, stage string, count int, record json.RawMessage, lab provenance) ([]string, error) {
	if lab.Variant == "" || lab.Provider == "" || lab.Model == "" || count < 1 || count > 100 || (stage != "plan" && stage != "compose" && stage != "figure") {
		return nil, errors.New("invalid lab seed stage or count")
	}
	root, err := isolatedTarget(source, data)
	if err != nil {
		return nil, err
	}
	lock, err := datalock.Acquire(root)
	if err != nil {
		return nil, err
	}
	defer lock.Close()
	db, err := store.Open(ctx, filepath.Join(root, "editorial.sqlite"))
	if err != nil {
		return nil, err
	}
	defer db.Close()
	ids := make([]string, 0, count)
	now := time.Now().UnixMilli()
	for range count {
		run, err := cloneRun(record, stage, now, lab)
		if err != nil {
			return nil, err
		}
		if err := db.CreateRun(ctx, run); err != nil {
			return nil, err
		}
		ids = append(ids, run.ID)
	}
	return ids, nil
}

func isolatedTarget(source, data string) (string, error) {
	lab, err := filepath.Abs(".local/figure-lab")
	if err != nil {
		return "", err
	}
	root, err := filepath.Abs(data)
	if err != nil {
		return "", err
	}
	actual, err := filepath.EvalSymlinks(root)
	if err != nil || actual != root || !strings.HasPrefix(root, lab+string(filepath.Separator)) {
		return "", errors.New("lab data must be an existing directory under .local/figure-lab")
	}
	sourceRoot, err := filepath.EvalSymlinks(source)
	if err != nil {
		return "", err
	}
	sourceRoot, err = filepath.Abs(sourceRoot)
	if err != nil || sourceRoot == root {
		return "", errors.New("source and lab data directories must differ")
	}
	for _, name := range []string{"editorial.sqlite", "editorial.sqlite-wal", "editorial.sqlite-shm", "editorial.sqlite-journal"} {
		info, err := os.Lstat(filepath.Join(root, name))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return "", err
		}
		if stat, ok := info.Sys().(*syscall.Stat_t); !ok || stat.Nlink != 1 || !info.Mode().IsRegular() {
			return "", errors.New("lab database files must be regular and unlinked")
		}
	}
	return root, nil
}

func cloneRun(record json.RawMessage, stage string, now int64, lab provenance) (contract.Run, error) {
	var source struct{ State object }
	if err := json.Unmarshal(record, &source); err != nil || source.State == nil {
		return contract.Run{}, errors.New("source record has no editorial state")
	}
	state := source.State
	id := uuid.NewString()
	state["articleId"] = id
	state["version"] = 1
	state["seen"] = object{}
	for _, key := range []string{"resumeStatus", "feedback", "feedbackSource", "routeReason", "retry"} {
		delete(state, key)
	}
	label := "초안 확정(시드)"
	if stage == "plan" {
		state["status"] = "satisfied"
		delete(state, "figure")
	} else {
		figure, _ := state["figure"].(object)
		if figure["phase"] != "choose" {
			return contract.Run{}, errors.New("figure composition requires a source at figure choice")
		}
		choice := object{}
		for _, key := range []string{"phase", "revision", "candidates", "coverage", "note"} {
			if value, ok := figure[key]; ok {
				choice[key] = value
			}
		}
		state["figure"] = choice
		state["status"] = "awaiting_figure_choice"
		label = "위치 후보(시드)"
	}
	value, err := json.Marshal(object{
		"id": id, "requestId": "lab-" + id, "state": state, "lab": lab,
		"ai": object{"enabled": true, "maxDurationMs": 300000}, "callsUsed": 0, "maxCalls": 8,
		"startedAt": now, "updatedAt": now, "operations": object{},
		"issue": nil, "pending": nil, "worker": nil, "queuedAt": now,
		"events": []object{{"at": now, "kind": "satisfied", "label": label, "revision": state["revision"]}},
	})
	if err != nil {
		return contract.Run{}, err
	}
	run := contract.Run{ID: id, RequestID: "lab-" + id, Version: 1, Value: value}
	action, err := writing.NewWithFigures(figuredomain.New()).Next(run)
	var transition struct{ Type string }
	if err != nil || json.Unmarshal(action.Input, &transition) != nil || transition.Type != "wait_for_user" {
		return contract.Run{}, errors.New("seeded state cannot be read by Go editorial rules")
	}
	return run, nil
}
