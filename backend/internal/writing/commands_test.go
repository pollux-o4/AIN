package writing

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

func TestAGENT001CommandAuthority(t *testing.T) {
	run := contract.Run{Value: json.RawMessage(`{"events":[{"kind":"requested","by":"user"},{"kind":"feedback","by":"agent"},{"kind":"complete","by":"adapter"},{"kind":"revise_brief","by":"agent"}]}`)}
	if err := CheckCommand(run, "satisfy", "agent"); !errors.Is(err, ErrHumanApproval) {
		t.Fatalf("agent satisfaction returned %v", err)
	}
	if err := CheckCommand(run, "feedback", "agent"); !errors.Is(err, ErrAgentFeedbackLimit) {
		t.Fatalf("agent third revision returned %v", err)
	}
	if err := CheckCommand(run, "feedback", "user"); err != nil {
		t.Fatal(err)
	}
	run.Value = json.RawMessage(`{"events":[{"kind":"feedback","by":"agent"},{"kind":"feedback","by":"user"},{"kind":"feedback","by":"agent"}]}`)
	if err := CheckCommand(run, "feedback", "agent"); err != nil {
		t.Fatal(err)
	}
}
