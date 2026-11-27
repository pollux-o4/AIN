package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/figureai"
)

func loadLabPolicy(data, path, outbox string) (*figureai.LabPolicy, error) {
	if path == "" {
		return nil, nil
	}
	if os.Getenv("AIN_LIVE") != "1" {
		return nil, errors.New("the figure lab requires explicit AIN_LIVE=1 consent")
	}
	lab, err := filepath.Abs(".local/figure-lab")
	if err != nil {
		return nil, err
	}
	const isolationError = "the figure lab requires an isolated data directory and private policy under .local/figure-lab"
	actual, err := filepath.EvalSymlinks(data)
	if err != nil || actual != data || !strings.HasPrefix(data, lab+string(filepath.Separator)) || outbox != "" {
		return nil, errors.New(isolationError)
	}
	for _, name := range []string{"workspaces", "writing-workspaces", "jobs"} {
		info, err := os.Lstat(filepath.Join(data, name))
		if !errors.Is(err, os.ErrNotExist) && (err != nil || !info.IsDir()) {
			return nil, errors.New(isolationError)
		}
	}
	for _, name := range []string{"editorial.sqlite", "editorial.sqlite-wal", "editorial.sqlite-shm", "editorial.sqlite-journal"} {
		info, err := os.Lstat(filepath.Join(data, name))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil || !info.Mode().IsRegular() {
			return nil, errors.New(isolationError)
		}
		if stat, ok := info.Sys().(*syscall.Stat_t); !ok || stat.Nlink != 1 {
			return nil, errors.New(isolationError)
		}
	}
	path, err = filepath.Abs(path)
	if err != nil || filepath.Dir(path) != data {
		return nil, errors.New(isolationError)
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
		return nil, errors.New(isolationError)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	var policy figureai.LabPolicy
	decoder := json.NewDecoder(io.LimitReader(file, 32768))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&policy); err != nil || decoder.Decode(new(any)) != io.EOF {
		return nil, errors.New("invalid private figure lab policy")
	}
	return &policy, nil
}

type labStateReader interface {
	ScanPending(context.Context, func(contract.Intent) error) error
	ListSummaries(context.Context, func(contract.RunSummary) error) error
}

func requireIdleLab(ctx context.Context, data labStateReader) error {
	busy := errors.New("lab data contains prior unfinished work; finish or pause it before starting a new lab session")
	if err := data.ScanPending(ctx, func(contract.Intent) error { return busy }); err != nil {
		return err
	}
	return data.ListSummaries(ctx, func(run contract.RunSummary) error {
		if !run.Archived {
			switch run.Status {
			case "waiting_ai", "waiting_route", "waiting_figure":
				return busy
			}
		}
		return nil
	})
}
