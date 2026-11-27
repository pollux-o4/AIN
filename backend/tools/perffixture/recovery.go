package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/editorial"
	"github.com/pollux-o4/AIN/backend/internal/figuredomain"
	"github.com/pollux-o4/AIN/backend/internal/writing"
)

func (app *application) stopRunner() error {
	if app.cancel == nil {
		return nil
	}
	app.cancel()
	err := <-app.done
	app.cancel = nil
	return err
}

func (app *application) seedAndRecover(ctx context.Context, completedID string) (any, error) {
	if err := app.stopRunner(); err != nil {
		return nil, err
	}
	original, err := app.db.GetRun(ctx, completedID)
	if err != nil {
		return nil, err
	}
	if err := app.seedHistory(ctx, original); err != nil {
		return nil, err
	}
	ids, err := app.seedQueued(ctx)
	if err != nil {
		return nil, err
	}
	if err := app.stop(); err != nil {
		return nil, err
	}
	file, err := os.Stat(app.database())
	if err != nil {
		return nil, err
	}
	begin := time.Now()
	if err := app.bind(ctx); err != nil {
		return nil, err
	}
	wait, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := app.wire.awaitDispatch(wait, ids); err != nil {
		return nil, err
	}
	return map[string]any{
		"recoveryMs":    float64(time.Since(begin)) / float64(time.Millisecond),
		"databaseBytes": file.Size(), "ids": ids,
	}, nil
}

func (app *application) seedHistory(ctx context.Context, original contract.Run) error {
	var row map[string]json.RawMessage
	var state map[string]json.RawMessage
	if json.Unmarshal(original.Value, &row) != nil || json.Unmarshal(row["state"], &state) != nil {
		return errors.New("invalid fixture source article")
	}
	history := make([]map[string]any, 8)
	body := strings.Repeat("x", app.config.HistoryBytes/8)
	for index := range history {
		revision := index + 1
		history[index] = map[string]any{
			"revision": revision,
			"artifacts": map[string]any{
				"draft": map[string]any{"revision": revision, "output": map[string]string{"text": fmt.Sprintf("# 합성 이력 %d\n\n%s", revision, body)}},
			},
		}
	}
	state["history"], _ = json.Marshal(history)
	for index := 0; index < app.config.HistoryCount; index++ {
		id := uuid.NewString()
		requestID := fmt.Sprintf("perf-history-%d", index)
		state["articleId"], _ = json.Marshal(id)
		row["id"], _ = json.Marshal(id)
		row["requestId"], _ = json.Marshal(requestID)
		row["state"], _ = json.Marshal(state)
		value, err := json.Marshal(row)
		if err != nil {
			return err
		}
		item := contract.Run{ID: id, RequestID: requestID, Version: original.Version, Value: value}
		if err := app.db.CreateRun(ctx, item); err != nil {
			return err
		}
	}
	return nil
}

type offlineScheduler struct{ contract.Scheduler }

func (offlineScheduler) Wake(string) {}

func (app *application) seedQueued(ctx context.Context) ([]string, error) {
	creator := editorial.Creator{Store: app.db, Rules: writing.NewWithFigures(figuredomain.New()), Scheduler: offlineScheduler{}}
	ids := make([]string, 0, 4)
	for index := 0; index < 4; index++ {
		input, err := json.Marshal(map[string]string{"requestId": fmt.Sprintf("perf-recovery-%d", index), "idea": app.config.Idea})
		if err != nil {
			return nil, err
		}
		run, err := creator.Create(ctx, input)
		if err != nil {
			return nil, err
		}
		ids = append(ids, run.ID)
	}
	return ids, nil
}
