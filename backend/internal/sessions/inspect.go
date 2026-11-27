package sessions

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"path/filepath"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

type Boundary struct {
	Epoch        string
	After        int64
	DaemonTurnID string
	Usage        map[string]int64
}

type remoteAgent struct {
	ID                 string                     `json:"id"`
	Provider           string                     `json:"provider"`
	Model              string                     `json:"model"`
	Thinking           string                     `json:"thinkingOptionId"`
	Mode               string                     `json:"currentModeId"`
	Status             string                     `json:"status"`
	Labels             map[string]string          `json:"labels"`
	ArchivedAt         string                     `json:"archivedAt"`
	ActiveTurn         json.RawMessage            `json:"activeTurn"`
	PendingPermissions []json.RawMessage          `json:"pendingPermissions"`
	Usage              map[string]json.RawMessage `json:"lastUsage"`
}

type remotePage struct {
	Agent    *remoteAgent `json:"agent"`
	Error    *string      `json:"error"`
	HasOlder bool         `json:"hasOlder"`
	Entries  []struct {
		TurnID    string `json:"turnId"`
		SeqStart  int64  `json:"seqStart"`
		SeqEnd    int64  `json:"seqEnd"`
		Timestamp string `json:"timestamp"`
		Item      struct {
			Type            string          `json:"type"`
			Text            string          `json:"text"`
			ClientMessageID string          `json:"clientMessageId"`
			MessageID       string          `json:"messageId"`
			Status          string          `json:"status"`
			Detail          json.RawMessage `json:"detail"`
		} `json:"item"`
	} `json:"entries"`
}

func (m *Manager) inspect(ctx context.Context, worker Worker) (remoteAgent, Boundary, error) {
	snapshot, err := m.wire.Snapshot(ctx, contract.RemoteRef{AgentID: worker.AgentID})
	if err != nil {
		return remoteAgent{}, Boundary{}, err
	}
	page, err := decodePage(snapshot)
	if err != nil {
		return remoteAgent{}, Boundary{}, err
	}
	agent := *page.Agent
	if agent.ID != worker.AgentID || agent.Provider != worker.Provider || agent.Labels["owner"] != worker.Owner ||
		agent.Labels["source"] != worker.Source || agent.Labels["job"] != worker.OriginJob {
		return remoteAgent{}, Boundary{}, ErrOwnership
	}
	boundary := Boundary{Epoch: snapshot.Ref.Epoch, After: snapshot.Ref.After, Usage: usageCounters(agent.Usage)}
	var position int64
	for _, entry := range page.Entries {
		if entry.TurnID != "" && entry.SeqEnd >= position && entry.SeqEnd <= boundary.After {
			position, boundary.DaemonTurnID = entry.SeqEnd, entry.TurnID
		}
	}
	return agent, boundary, nil
}

func decodePage(snapshot contract.Snapshot) (remotePage, error) {
	var page remotePage
	if snapshot.Ref.AgentID == "" || snapshot.Ref.Epoch == "" || snapshot.Ref.After < 0 ||
		json.Unmarshal(snapshot.Body, &page) != nil || page.Error != nil ||
		page.Agent == nil || page.Agent.ID != snapshot.Ref.AgentID || page.Agent.Status == "" {
		return remotePage{}, errors.New("invalid Paseo observation")
	}
	return page, nil
}

func idle(agent remoteAgent) bool {
	return agent.ArchivedAt == "" && agent.Status == "idle" && string(agent.ActiveTurn) == "null" &&
		len(agent.PendingPermissions) == 0
}

func closed(agent remoteAgent) bool {
	return agent.ArchivedAt != "" || ((agent.Status == "idle" || agent.Status == "error") &&
		string(agent.ActiveTurn) == "null" && len(agent.PendingPermissions) == 0)
}

func compatible(agent remoteAgent, boundary, saved Boundary, desired contract.SessionSpec) bool {
	return idle(agent) && boundary.Epoch == saved.Epoch && boundary.After == saved.After &&
		boundary.DaemonTurnID == saved.DaemonTurnID && (desired.Mode == "" || desired.Mode == agent.Mode)
}

func sameOwner(path string) bool { return filepath.IsAbs(path) && filepath.Clean(path) == path }

func usageCounters(source map[string]json.RawMessage) map[string]int64 {
	counters := map[string]int64{}
	for key, raw := range source {
		var value int64
		if json.Unmarshal(raw, &value) == nil && string(raw) != "null" {
			counters[key] = value
		}
	}
	return publicUsage(counters)
}

func publicUsage(usage map[string]int64) map[string]int64 {
	result := map[string]int64{}
	for _, key := range []string{"inputTokens", "cachedInputTokens", "outputTokens", "totalTokens"} {
		if value, ok := usage[key]; ok && value >= 0 {
			result[key] = value
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

// TurnUsage attributes a new reading only when the provider reports distinct
// token counters after the exact durable turn is proved.
func (l Lease) TurnUsage(result contract.Snapshot, current map[string]int64) map[string]int64 {
	current = publicUsage(current)
	if !l.ProvesResult(result) || l.worker.Provider != "antigravity" || maps.Equal(l.worker.Boundary.Usage, current) {
		return nil
	}
	return current
}
