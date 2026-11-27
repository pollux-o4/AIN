package editorial

import (
	"context"
	"testing"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

func TestLIVE001FigureMonitorUsesObservedChildTurn(t *testing.T) {
	ctx := t.Context()
	clock := func() time.Time { return time.UnixMilli(30000) }
	reader := &monitorBatchStore{
		parent: contract.Intent{ID: "parent"},
		children: []contract.BatchChild{
			{Intent: contract.Intent{ID: "child", Remote: contract.RemoteRef{AgentID: "agent"}}, Started: true},
		},
	}
	q := Queries{Store: reader, Now: clock}
	run := publicRunRecord{State: publicRunState{
		Stage: "review", Status: "waiting_figure",
		Figure: map[string]any{
			"phase":   "generate",
			"current": map[string]any{"ids": []any{"f1"}, "pass": "draw"},
		},
	}}
	startedAt := int64(1)
	run.StartedAt = &startedAt

	queued, err := q.monitor(ctx, "article", run, false, false)
	if err != nil || queued.Kind != "queued" || queued.LastConfirmedAt != nil {
		t.Fatalf("reserved child: %+v, %v", queued, err)
	}
	reader.children[0].Remote.TurnID = "proved-client-message"
	working, err := q.monitor(ctx, "article", run, false, false)
	if err != nil || working.Kind != "working" || working.Label != "시각자료 생성 1장 동시 · 그리기 1/1 중" {
		t.Fatalf("observed child: %+v, %v", working, err)
	}
	reader.children[0].Failure = "synthetic failed child"
	queued, err = q.monitor(ctx, "article", run, false, false)
	if err != nil || queued.Kind != "queued" {
		t.Fatalf("settled child: %+v, %v", queued, err)
	}
}

type monitorBatchStore struct {
	RunReader
	parent   contract.Intent
	children []contract.BatchChild
}

func (s *monitorBatchStore) PendingRun(context.Context, string) (contract.Intent, error) {
	return s.parent, nil
}

func (s *monitorBatchStore) BatchChildren(context.Context, string) ([]contract.BatchChild, error) {
	return s.children, nil
}
