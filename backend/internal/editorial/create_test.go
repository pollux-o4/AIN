package editorial

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/store"
	"github.com/pollux-o4/AIN/backend/internal/writing"
)

type wakeRecorder chan string

func (w wakeRecorder) Wake(id string)                    { w <- id }
func (wakeRecorder) Pause(context.Context, string) error { return nil }
func (wakeRecorder) Recover(context.Context) error       { return nil }

func TestAINAPI001ConcurrentCreation(t *testing.T) {
	ctx := t.Context()
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "private", "editorial.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	wakes := make(wakeRecorder, 2)
	creator := Creator{Store: db, Rules: writing.New(), Scheduler: wakes}
	body := json.RawMessage(`{"requestId":"same-request","idea":"테스트 글감"}`)
	type outcome struct {
		run contract.Run
		err error
	}
	results := make(chan outcome, 2)
	start := make(chan struct{})
	for range 2 {
		go func() {
			<-start
			run, err := creator.Create(ctx, body)
			results <- outcome{run, err}
		}()
	}
	close(start)
	first, second := <-results, <-results
	if first.err != nil || second.err != nil || first.run.ID == "" || first.run.ID != second.run.ID {
		t.Fatalf("unexpected results: %q/%v and %q/%v", first.run.ID, first.err, second.run.ID, second.err)
	}
	for range 2 {
		if got := <-wakes; got != first.run.ID {
			t.Fatalf("unexpected scheduled ID %q", got)
		}
	}
	_, err = creator.Create(ctx, json.RawMessage(`{"requestId":"same-request","idea":"다른 글감"}`))
	if !errors.Is(err, contract.ErrConflict) || len(wakes) != 0 {
		t.Fatalf("changed retry: %v", err)
	}
}
