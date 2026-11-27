package paseowire

import (
	"encoding/json"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

// Paseo 0.17.5 emits Claude's result usage on the typed completion stream.
// shortcut: 에이전트 lastUsage와 표시용 turnMetrics에서는 횟수를 복원하지 않는다. 다른 제공자가 턴별 정확한 값을 내보내면 계약을 대조한다.
type observedTurnUsage struct {
	epoch, turn string
	usage       *contract.TurnUsage
}

func (o *observeState) observeUsage(body json.RawMessage, epoch string) {
	if epoch == "" {
		// The daemon omits epoch on live lifecycle events. Use the last
		// projection from this socket only, never a reconnect cursor.
		if !o.observedSnapshot {
			return
		}
		epoch = o.cursor.Epoch
	}
	if epoch == "" {
		return
	}
	var wire struct {
		Type     string          `json:"type"`
		Provider string          `json:"provider"`
		TurnID   string          `json:"turnId"`
		Usage    json.RawMessage `json:"usage"`
	}
	if json.Unmarshal(body, &wire) != nil || wire.Type != "turn_completed" || wire.Provider != "claude" || wire.TurnID == "" {
		return
	}
	usage := contract.DecodeTurnUsage(wire.Usage)
	if o.usage.epoch == epoch && o.usage.turn == wire.TurnID {
		if !o.usage.usage.Valid() || !usage.Valid() || *o.usage.usage != *usage {
			o.usage.usage = nil
		}
		return
	}
	o.usage = observedTurnUsage{epoch: epoch, turn: wire.TurnID, usage: usage}
}

func (o *observeState) matchedUsage(snapshot contract.Snapshot) *contract.TurnUsage {
	if snapshot.Status != "completed" || snapshot.Ref.AgentID != o.agentID ||
		snapshot.Ref.Epoch != o.usage.epoch || !o.usage.usage.Valid() {
		return nil
	}
	var result turnResult
	if json.Unmarshal(snapshot.Body, &result) != nil || result.DaemonTurnID != o.usage.turn {
		return nil
	}
	return o.usage.usage
}
