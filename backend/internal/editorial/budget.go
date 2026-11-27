package editorial

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

const initialCalls = 8
const initialLimit = 30 * time.Minute

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
		LastCall  struct {
			Stage    string
			Revision int
		}
	}
	if err := json.Unmarshal(run.Value, &budget); err != nil {
		return run, err
	}
	var input struct{ Revision int }
	if err := json.Unmarshal(action.Input, &input); err != nil {
		return run, err
	}
	revision := input.Revision
	if budget.MaxCalls == 0 {
		budget.MaxCalls = initialCalls
	}
	if budget.StartedAt == 0 {
		budget.StartedAt = now.UnixMilli()
	}
	sameStage := action.Stage == budget.LastCall.Stage && revision == budget.LastCall.Revision && action.Stage == "draft"
	if now.UnixMilli()-budget.StartedAt > initialLimit.Milliseconds() || (!sameStage && budget.CallsUsed >= budget.MaxCalls) {
		return run, ErrBudget
	}
	if !sameStage {
		budget.CallsUsed++
	}
	record["callsUsed"], _ = json.Marshal(budget.CallsUsed)
	record["maxCalls"], _ = json.Marshal(budget.MaxCalls)
	record["startedAt"], _ = json.Marshal(budget.StartedAt)
	record["lastCall"], _ = json.Marshal(map[string]any{"stage": action.Stage, "revision": revision})
	value, err := json.Marshal(record)
	if err != nil {
		return run, err
	}
	run.Version++
	run.Value = value
	return run, nil
}
