package editorial

import (
	"context"
	"encoding/json"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

func (c Commands) SetArchived(ctx context.Context, id string, archive bool) error {
	run, err := c.Store.GetRun(ctx, id)
	if err != nil {
		return err
	}
	var record map[string]json.RawMessage
	if err := json.Unmarshal(run.Value, &record); err != nil {
		return err
	}
	var state struct {
		Status   string
		Revision int64
	}
	if err := json.Unmarshal(record["state"], &state); err != nil {
		return err
	}
	if archive && isPending(state.Status) {
		return contract.ErrConflict
	}
	if isArchived(record["archivedAt"]) == archive {
		return nil
	}
	now := time.Now().UnixMilli()
	kind, label := "restored", "목록에 복원"
	if archive {
		kind, label = "archived", "목록에서 삭제"
		record["archivedAt"], _ = json.Marshal(now)
	} else {
		delete(record, "archivedAt")
	}
	var events []json.RawMessage
	if raw := record["events"]; raw != nil {
		if err := json.Unmarshal(raw, &events); err != nil {
			return err
		}
	}
	event, _ := json.Marshal(map[string]any{"kind": kind, "label": label, "at": now, "revision": state.Revision})
	record["events"], _ = json.Marshal(append(events, event))
	record["updatedAt"], _ = json.Marshal(now)
	next := run
	next.Version++
	next.Value, err = json.Marshal(record)
	if err != nil {
		return err
	}
	return c.Store.UpdateRun(ctx, run.Version, next)
}

func isArchived(value json.RawMessage) bool {
	switch string(value) {
	case "", "null", "false", "0", `""`:
		return false
	default:
		return true
	}
}

func isPending(status string) bool {
	return status == "waiting_ai" || status == "waiting_route" || status == "waiting_figure"
}
