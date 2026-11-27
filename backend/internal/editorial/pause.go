package editorial

import (
	"encoding/json"

	"github.com/google/uuid"
	"github.com/pollux-o4/AIN/backend/internal/contract"
)

func PauseTransition(rules contract.EditorialRules) func(contract.Run, *contract.Event) (contract.Run, error) {
	return func(run contract.Run, result *contract.Event) (contract.Run, error) {
		if result != nil {
			next, err := rules.Reduce(run, *result)
			if err != nil {
				return run, err
			}
			run = next
			action, err := rules.Next(run)
			if err != nil || action.Kind == "" {
				return run, err
			}
		}
		var record struct{ State struct{ Version int64 } }
		if err := json.Unmarshal(run.Value, &record); err != nil {
			return run, err
		}
		body, err := json.Marshal(map[string]int64{"expectedVersion": record.State.Version})
		if err != nil {
			return run, err
		}
		return rules.Reduce(run, contract.Event{ID: uuid.NewString(), Actor: "user", Kind: "pause", Body: body})
	}
}
