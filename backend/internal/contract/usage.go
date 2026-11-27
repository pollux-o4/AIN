package contract

import "encoding/json"

// TurnUsage is the exact reported input/output pair independently attributed
// to one confirmed completion. A missing pair means unavailable.
type TurnUsage struct {
	InputTokens  int64 `json:"inputTokens"`
	OutputTokens int64 `json:"outputTokens"`
}

const maxExactTokenCount = 1<<53 - 1

func (u *TurnUsage) Valid() bool {
	return u != nil && u.InputTokens >= 0 && u.OutputTokens >= 0 &&
		u.OutputTokens <= maxExactTokenCount && u.InputTokens <= maxExactTokenCount-u.OutputTokens
}

// DecodeTurnUsage keeps an absent field distinct from an explicit zero.
func DecodeTurnUsage(data json.RawMessage) *TurnUsage {
	var reported struct {
		InputTokens  *int64 `json:"inputTokens"`
		OutputTokens *int64 `json:"outputTokens"`
	}
	if json.Unmarshal(data, &reported) != nil || reported.InputTokens == nil || reported.OutputTokens == nil {
		return nil
	}
	pair := &TurnUsage{InputTokens: *reported.InputTokens, OutputTokens: *reported.OutputTokens}
	if !pair.Valid() {
		return nil
	}
	return pair
}
