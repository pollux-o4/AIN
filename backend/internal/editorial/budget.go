package editorial

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

const initialCalls = 8
const initialLimit = 30 * time.Minute
const followupCalls = initialCalls + 1
const figureLimit = time.Hour

var ErrBudget = errors.New("이번 요청의 실행 한도에 도달했습니다.")

// ReserveTurn increments the budget and records the active stage before the
// remote call. The runner persists this change atomically with its intent.
func ReserveTurn(now time.Time, run contract.Run, action contract.Action) (contract.Run, error) {
	var record map[string]json.RawMessage
	if err := json.Unmarshal(run.Value, &record); err != nil || record == nil {
		return run, errors.New("invalid editorial budget record")
	}
	var budget struct {
		StartedAt int64
		CallsUsed int
		MaxCalls  int
		State     struct {
			Revision   int64
			DraftParts []json.RawMessage
			Retry      struct{ Stage string }
		}
	}
	if err := json.Unmarshal(run.Value, &budget); err != nil {
		return run, err
	}
	if budget.MaxCalls == 0 {
		budget.MaxCalls = initialCalls
	}
	if budget.StartedAt == 0 {
		budget.StartedAt = now.UnixMilli()
	}
	sameStage := action.Stage == "draft" && len(budget.State.DraftParts) != 0 ||
		action.Stage != "" && action.Stage == budget.State.Retry.Stage
	limit := initialLimit
	if action.Kind == "request_figure" && action.Stage == "figure" {
		limit = figureLimit
	}
	if now.UnixMilli()-budget.StartedAt > limit.Milliseconds() || (!sameStage && budget.CallsUsed >= budget.MaxCalls) {
		return run, ErrBudget
	}
	if !sameStage {
		budget.CallsUsed++
	}
	record["callsUsed"], _ = json.Marshal(budget.CallsUsed)
	record["maxCalls"], _ = json.Marshal(budget.MaxCalls)
	record["startedAt"], _ = json.Marshal(budget.StartedAt)
	if err := appendActivity(record, activityEvent{
		At: now.UnixMilli(), Kind: "ai_requested", Label: "AI 작업 예약",
		Revision: budget.State.Revision, Stage: action.Stage, JobID: action.WorkID,
	}); err != nil {
		return run, err
	}
	value, err := json.Marshal(record)
	if err != nil {
		return run, err
	}
	run.Version++
	run.Value = value
	return run, nil
}
