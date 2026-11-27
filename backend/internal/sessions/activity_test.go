package sessions

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"unicode/utf16"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

func TestLIVE001ReadOnlyScopedAndBoundedActivity(t *testing.T) {
	entries := []any{
		activityEntry(10, "old", "assistant_message", "OLD_PRIVATE"),
		activityEntry(11, "new", "user_message", "PROMPT_PRIVATE"),
		activityEntry(12, "new", "reasoning", "REASONING_PRIVATE"),
		activityEntry(13, "new", "assistant_message", "진행 중\n```json\n{\"draft\":\"RESULT_PRIVATE\"}\n```"),
		activityEntry(14, "foreign", "assistant_message", "FOREIGN_PRIVATE"),
	}
	for i := range ActivityStepLimit + 1 {
		entries = append(entries, activityEntry(15+i, "new", "assistant_message", strings.Repeat("🧪", 300)))
	}
	entries = append(entries, activityEntry(56, "new", "tool_call", "TOOL_PRIVATE"))
	body, _ := json.Marshal(map[string]any{
		"agent": map[string]string{"id": "agent", "status": "running"}, "entries": entries,
	})
	assignment := Assignment{
		Remote:    contract.RemoteRef{AgentID: "agent"},
		Boundary:  Boundary{Epoch: "epoch", After: 10, DaemonTurnID: "old"},
		MessageID: "client-message",
	}
	snapshot := contract.Snapshot{
		Ref:    contract.RemoteRef{AgentID: "agent", Epoch: "epoch", After: 56, TurnID: assignment.MessageID},
		Status: "running", Body: body,
	}
	activity, err := ProjectActivity(snapshot, assignment)
	if err != nil || activity.Phase != "tool" || !activity.Truncated || len(activity.Steps) != ActivityStepLimit ||
		activity.Steps[len(activity.Steps)-1].Text != "자료 읽기" || len([]rune(activity.Steps[0].Text)) != ActivityNoteLimit/2 ||
		activity.LastOutputAt == nil || len(utf16.Encode([]rune(activity.Text))) > ActivityTextLimit {
		t.Fatalf("unexpected activity shape, error = %v", err)
	}
	encoded, err := json.Marshal(activity)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "PRIVATE") {
		t.Fatal("nonpublic timeline content reached live activity")
	}
	snapshot.Ref.Epoch = "replaced"
	if result, err := ProjectActivity(snapshot, assignment); !errors.Is(err, contract.ErrDeliveryUncertain) ||
		result.Phase != "unavailable" || result.Text != "" || len(result.Steps) != 0 {
		t.Fatal("a replaced epoch reached the old activity subscriber")
	}
}

func activityEntry(seq int, turn, kind, text string) map[string]any {
	return map[string]any{
		"seqStart": seq, "seqEnd": seq, "turnId": turn, "timestamp": "2026-11-27T00:00:00Z",
		"item": map[string]any{
			"type": kind, "text": text, "clientMessageId": "client-message", "status": "running",
			"detail": map[string]string{"type": "read", "path": "TOOL_PRIVATE"},
		},
	}
}
