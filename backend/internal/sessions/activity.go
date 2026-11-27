package sessions

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

const (
	ActivityTextLimit = 24000
	ActivityStepLimit = 40
	ActivityNoteLimit = 400
)

type Activity struct {
	Phase        string `json:"phase"`
	Text         string `json:"text"`
	Truncated    bool   `json:"truncated"`
	LastOutputAt *int64 `json:"lastOutputAt"`
	Steps        []Step `json:"steps"`
}

type Step struct {
	Kind   string `json:"kind"`
	Text   string `json:"text"`
	Status string `json:"status,omitempty"`
	At     *int64 `json:"at"`
}

// ProjectActivity reads the timeline for just the assigned turn. Unvalidated
// structured output, internal reasoning and tool arguments never enter it.
func ProjectActivity(snapshot contract.Snapshot, assignment Assignment) (Activity, error) {
	activity := Activity{Phase: "waiting", Steps: []Step{}}
	if snapshot.Ref.AgentID != assignment.Remote.AgentID ||
		(assignment.Boundary.Epoch != "" && snapshot.Ref.Epoch != assignment.Boundary.Epoch) ||
		snapshot.Ref.After < assignment.Boundary.After {
		activity.Phase = "unavailable"
		return activity, contract.ErrDeliveryUncertain
	}
	if snapshot.Ref.TurnID != "" && snapshot.Ref.TurnID != assignment.MessageID {
		activity.Phase = "unavailable"
		return activity, contract.ErrDeliveryUncertain
	}
	switch snapshot.Status {
	case "completed", "failed", "cancelled", "stopped":
		if snapshot.Ref.TurnID == "" || snapshot.Ref.TurnID != assignment.MessageID {
			activity.Phase = "unavailable"
			return activity, contract.ErrDeliveryUncertain
		}
		activity.Phase = "validating"
		if snapshot.Status == "failed" {
			activity.Phase = "failed"
		}
		return activity, nil
	}
	page, err := decodePage(snapshot)
	if err != nil {
		activity.Phase = "unavailable"
		return activity, err
	}
	var submittedAt, latestSubmission int64
	var nativeTurn string
	for _, entry := range page.Entries {
		if entry.Item.Type != "user_message" || entry.SeqStart <= assignment.Boundary.After ||
			entry.SeqEnd < entry.SeqStart || entry.SeqEnd > snapshot.Ref.After {
			continue
		}
		latestSubmission = max(latestSubmission, entry.SeqEnd)
		id := entry.Item.ClientMessageID
		if id == "" {
			id = entry.Item.MessageID
		}
		if id == "" || id != assignment.MessageID || entry.TurnID == "" ||
			entry.TurnID == assignment.Boundary.DaemonTurnID {
			continue
		}
		if nativeTurn != "" && nativeTurn != entry.TurnID {
			activity.Phase = "unavailable"
			return activity, contract.ErrDeliveryUncertain
		}
		submittedAt, nativeTurn = max(submittedAt, entry.SeqEnd), entry.TurnID
	}
	if nativeTurn == "" {
		return activity, nil
	}
	var current struct{ TurnID string }
	_ = json.Unmarshal(page.Agent.ActiveTurn, &current)
	if latestSubmission > submittedAt || (current.TurnID != "" && current.TurnID != nativeTurn) {
		activity.Phase = "unavailable"
		return activity, contract.ErrDeliveryUncertain
	}

	var text strings.Builder
	var lastKind, lastStatus string
	for _, entry := range page.Entries {
		if entry.TurnID != nativeTurn || entry.SeqStart <= submittedAt ||
			entry.SeqEnd < entry.SeqStart || entry.SeqEnd > snapshot.Ref.After {
			continue
		}
		at := milliseconds(entry.Timestamp)
		switch entry.Item.Type {
		case "assistant_message":
			lastKind, activity.LastOutputAt = "note", at
			note := strings.TrimSpace(entry.Item.Text)
			if note == "" || looksStructured(note) {
				continue
			}
			if text.Len() > 0 {
				text.WriteString("\n\n")
			}
			text.WriteString(note)
			note, _ = limitText(note, ActivityNoteLimit)
			activity.Steps = append(activity.Steps, Step{Kind: "note", Text: note, At: at})
		case "tool_call":
			lastKind, lastStatus = "tool", entry.Item.Status
			activity.Steps = append(activity.Steps, Step{
				Kind: "tool", Text: toolLabel(entry.Item.Detail), Status: toolStatus(entry.Item.Status), At: at,
			})
		}
	}
	activity.Text, activity.Truncated = limitText(text.String(), ActivityTextLimit)
	activity.Truncated = activity.Truncated || page.HasOlder || len(activity.Steps) > ActivityStepLimit
	if len(activity.Steps) > ActivityStepLimit {
		activity.Steps = activity.Steps[len(activity.Steps)-ActivityStepLimit:]
	}
	switch {
	case page.Agent.Status == "error":
		activity.Phase = "failed"
	case len(page.Agent.PendingPermissions) > 0:
		activity.Phase = "permission"
	case page.Agent.Status == "idle":
		activity.Phase = "validating"
	case lastKind == "tool" && lastStatus == "running":
		activity.Phase = "tool"
	case lastKind == "note" || activity.Text != "":
		activity.Phase = "generating"
	}
	return activity, nil
}

func looksStructured(value string) bool {
	for line := range strings.SplitSeq(value, "\n") {
		line = strings.TrimSpace(line)
		if rest, fenced := strings.CutPrefix(line, "```"); fenced {
			rest = strings.TrimSpace(rest)
			if strings.HasPrefix(strings.ToLower(rest), "json") {
				return true
			}
			line = rest
		}
		if strings.HasPrefix(line, "{") || strings.HasPrefix(line, "[") {
			return true
		}
	}
	return false
}

func toolLabel(raw json.RawMessage) string {
	var detail struct{ Type string }
	_ = json.Unmarshal(raw, &detail)
	switch detail.Type {
	case "shell":
		return "명령 실행"
	case "edit":
		return "파일 수정"
	case "read":
		return "자료 읽기"
	case "search":
		return "자료 찾기"
	case "web":
		return "웹 확인"
	default:
		return "도구 실행"
	}
}

func toolStatus(status string) string {
	if status == "completed" || status == "failed" {
		return status
	}
	return "running"
}

func limitText(text string, limit int) (string, bool) {
	for i, r := range text {
		limit--
		if r > 0xffff {
			limit--
		}
		if limit < 0 {
			return text[:i], true
		}
	}
	return text, false
}

func milliseconds(value string) *int64 {
	at, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return nil
	}
	result := at.UnixMilli()
	return &result
}
