package editorial

import (
	"context"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
)

type listItem struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Revision  int64  `json:"revision"`
	Status    string `json:"status"`
	Label     string `json:"label"`
	UpdatedAt *int64 `json:"updatedAt"`
}

func (q Queries) ListView(ctx context.Context) (json.RawMessage, error) {
	summaries, err := q.List(ctx)
	if err != nil {
		return nil, err
	}
	items := make([]listItem, 0, len(summaries))
	for _, run := range summaries {
		if run.Archived {
			continue
		}
		title, _, _ := strings.Cut(run.Idea, "\n")
		if chars := []rune(title); len(chars) > 100 {
			title = string(chars[:100]) + "…"
		}
		item := listItem{ID: run.ID, Title: title, Revision: run.Revision, Status: run.Status, Label: stateLabel(run.Status)}
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

func stateLabel(status string) string {
	switch status {
	case "waiting_ai", "waiting_route", "waiting_figure":
		return "작업 중"
	case "awaiting_user":
		return "초안 준비됨"
	case "paused":
		return "중단됨"
	case "failed":
		return "실패"
	case "satisfied":
		return "만족"
	case "publication_ready":
		return "발행 준비"
	default:
		return "확인 대기"
	}
}
