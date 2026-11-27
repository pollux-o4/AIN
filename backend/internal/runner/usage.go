package runner

import (
	"encoding/json"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

func corroboratedUsage(confirmed contract.Snapshot, observed *contract.Snapshot) *contract.TurnUsage {
	if confirmed.Status != "completed" {
		return nil
	}
	if confirmed.Usage.Valid() {
		return confirmed.Usage
	}
	if observed == nil || observed.Status != "completed" || !observed.Usage.Valid() ||
		confirmed.Ref.AgentID != observed.Ref.AgentID || confirmed.Ref.TurnID == "" ||
		confirmed.Ref.TurnID != observed.Ref.TurnID || confirmed.Ref.Epoch == "" ||
		confirmed.Ref.Epoch != observed.Ref.Epoch || confirmed.Ref.After < observed.Ref.After {
		return nil
	}
	var a, b struct {
		DaemonTurnID string `json:"daemonTurnId"`
	}
	if json.Unmarshal(confirmed.Body, &a) != nil || json.Unmarshal(observed.Body, &b) != nil ||
		a.DaemonTurnID == "" || a.DaemonTurnID != b.DaemonTurnID {
		return nil
	}
	return observed.Usage
}

func completeBatchUsage(children []contract.BatchChild) *contract.TurnUsage {
	if len(children) == 0 {
		return nil
	}
	sum := &contract.TurnUsage{}
	for _, child := range children {
		if child.Result == nil || !child.Result.Usage.Valid() {
			return nil
		}
		sum.InputTokens += child.Result.Usage.InputTokens
		sum.OutputTokens += child.Result.Usage.OutputTokens
		if !sum.Valid() {
			return nil
		}
	}
	return sum
}
