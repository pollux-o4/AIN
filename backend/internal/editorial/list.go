package editorial

import (
	"context"
	"encoding/json"
	"sort"
	"strconv"

	"github.com/pollux-o4/AIN/backend/internal/contract"

	"github.com/pollux-o4/AIN/backend/internal/writing"
)

type listItem struct {
	ID               string  `json:"id"`
	Title            string  `json:"title"`
	Revision         int64   `json:"revision"`
	Status           string  `json:"status"`
	Label            string  `json:"label"`
	NeedsCompletion  bool    `json:"needsCompletion"`
	CompletionReason *string `json:"completionReason"`
	UpdatedAt        *int64  `json:"updatedAt"`
}

func (q Queries) ListView(ctx context.Context) (json.RawMessage, error) {
	summaries, err := q.List(ctx)
	if err != nil {
		return nil, err
	}
	monitorQuery := q
	if reader, ok := q.Store.(compactPendingReader); ok {
		monitorQuery.Store = compactMonitorStore{RunReader: q.Store, reader: reader}
	}
	items := make([]listItem, 0, len(summaries))
	for _, run := range summaries {
		if run.Archived {
			continue
		}
		var record publicRunRecord
		if run.Monitor != "" {
			if err := json.Unmarshal([]byte(run.Monitor), &record); err != nil {
				return nil, err
			}
		}
		record.State.Status = run.Status
		monitor, err := monitorQuery.monitor(ctx, run.ID, record, run.NeedsCompletion, writing.OnMigrationHold(record.IssueKind))
		if err != nil {
			return nil, err
		}
		title := run.Title
		if title == "" {
			title = run.Idea
		}
		item := listItem{
			ID: run.ID, Title: displayTitle(title, ""), Revision: run.Revision, Status: run.Status,
			Label: monitor.Label, NeedsCompletion: run.NeedsCompletion,
		}
		if run.NeedsCompletion {
			reason := completionNotice
			item.CompletionReason = &reason
		}
		if updated, err := strconv.ParseInt(run.UpdatedAt, 10, 64); err == nil {
			item.UpdatedAt = &updated
		}
		items = append(items, item)
	}
	sort.SliceStable(items, func(i, j int) bool {
		left, right := items[i].UpdatedAt, items[j].UpdatedAt
		return left != nil && (right == nil || *left > *right)
	})
	return json.Marshal(struct {
		Runs []listItem `json:"runs"`
	}{Runs: items})
}

type compactPendingReader interface {
	PendingRunObservation(context.Context, string) (contract.Intent, error)
}

type compactMonitorStore struct {
	RunReader
	reader compactPendingReader
}

func (s compactMonitorStore) PendingRun(ctx context.Context, id string) (contract.Intent, error) {
	return s.reader.PendingRunObservation(ctx, id)
}
