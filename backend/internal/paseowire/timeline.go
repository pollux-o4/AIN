package paseowire

import (
	"encoding/json"
	"slices"
	"strings"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

type timeline struct {
	AgentID    string  `json:"agentId"`
	Epoch      string  `json:"epoch"`
	Projection string  `json:"projection"`
	Error      *string `json:"error"`
	Agent      *struct {
		ID     string `json:"id"`
		Status string `json:"status"`
		Active *struct {
			TurnID string `json:"turnId"`
		} `json:"activeTurn"`
	} `json:"agent"`
	Window *struct {
		MaxSeq int64 `json:"maxSeq"`
	} `json:"window"`
	Entries []timelineEntry `json:"entries"`
}

type timelineEntry struct {
	TurnID      string       `json:"turnId"`
	SeqStart    int64        `json:"seqStart"`
	SeqEnd      int64        `json:"seqEnd"`
	TurnMetrics []turnMetric `json:"turnMetrics"`
	Item        struct {
		Type            string `json:"type"`
		ClientMessageID string `json:"clientMessageId"`
		MessageID       string `json:"messageId"`
		Text            string `json:"text"`
	} `json:"item"`
}

type turnMetric struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

// A terminal body's text comes only from the proved daemon turn. Other
// snapshots still carry the timeline payload for observation.
type turnResult struct {
	DaemonTurnID string `json:"daemonTurnId"`
	Text         string `json:"text"`
}

func (p timeline) project(ref contract.RemoteRef, raw json.RawMessage) (contract.Snapshot, error) {
	current := contract.RemoteRef{AgentID: ref.AgentID, Epoch: p.Epoch, After: p.Window.MaxSeq}
	status := p.Agent.Status
	switch status {
	case "completed", "failed", "cancelled", "stopped":
		// These values describe proved turns, not the daemon's agent status.
		status = "unconfirmed"
	}
	snapshot := contract.Snapshot{Ref: current, Status: status, Body: raw}
	submission, latest := p.submission(ref.TurnID)
	if submission == nil || latest > submission.SeqEnd ||
		(p.Agent.Active != nil && p.Agent.Active.TurnID != submission.TurnID) ||
		(p.Agent.Status == "running" && p.Agent.Active == nil) {
		return snapshot, nil
	}
	snapshot.Ref.TurnID = ref.TurnID
	if p.Agent.Active != nil || submission.SeqEnd <= 0 {
		return snapshot, nil
	}

	status, text := p.terminalTurn(*submission)
	if status != "" {
		body, err := json.Marshal(turnResult{DaemonTurnID: submission.TurnID, Text: text})
		if err != nil {
			return contract.Snapshot{}, err
		}
		snapshot.Status, snapshot.Body = status, body
	}
	return snapshot, nil
}

func (p timeline) submission(messageID string) (*timelineEntry, int64) {
	if messageID == "" {
		return nil, 0
	}
	var match *timelineEntry
	var latest int64
	for i := range p.Entries {
		entry := &p.Entries[i]
		if entry.Item.Type != "user_message" {
			continue
		}
		latest = max(latest, entry.SeqEnd)
		observedID := entry.Item.ClientMessageID
		if observedID == "" {
			observedID = entry.Item.MessageID
		}
		if observedID != messageID || entry.TurnID == "" {
			continue
		}
		if match != nil && match.TurnID != entry.TurnID {
			return nil, 0
		}
		if match == nil || entry.SeqEnd > match.SeqEnd {
			match = entry
		}
	}
	return match, latest
}

func (p timeline) terminalTurn(submission timelineEntry) (status string, text string) {
	var response, footer int64
	for _, entry := range p.Entries {
		if entry.TurnID != submission.TurnID ||
			entry.SeqStart <= submission.SeqEnd || entry.SeqEnd < entry.SeqStart || entry.SeqEnd > p.Window.MaxSeq {
			continue
		}
		if p.Agent.Status == "error" && entry.Item.Type == "error" {
			return "failed", ""
		}
		if slices.ContainsFunc(entry.TurnMetrics, func(metric turnMetric) bool { return metric.Label != "" }) {
			footer = max(footer, entry.SeqEnd)
		}
		if entry.Item.Type == "assistant_message" && entry.SeqEnd > response && strings.TrimSpace(entry.Item.Text) != "" {
			response, text = entry.SeqEnd, entry.Item.Text
		}
	}
	// The daemon stamps turnMetrics only when settling a completed turn.
	// Agent idle and assistant text alone also occur after interruption.
	if p.Agent.Status == "idle" && response > 0 && footer >= response {
		return "completed", text
	}
	return "", ""
}
