package writing

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

func TestAGENT001CommandAuthority(t *testing.T) {
	run := contract.Run{Value: json.RawMessage(`{"events":[{"kind":"requested","by":"user"},{"kind":"feedback","by":"agent"},{"kind":"complete","by":"adapter"},{"kind":"revise_brief","by":"agent"}]}`)}
	if err := CheckCommand(run, "satisfy", "agent", false); !errors.Is(err, ErrHumanApproval) {
		t.Fatalf("agent satisfaction returned %v", err)
	}
	if err := CheckCommand(run, "feedback", "agent", false); !errors.Is(err, ErrAgentFeedbackLimit) {
		t.Fatalf("agent third revision returned %v", err)
	}
	// 사용자가 맡긴 요청은 한도에 세지 않지만 사람만 하는 동작은 그대로 거부 · ADR-0006
	if err := CheckCommand(run, "feedback", "agent", true); err != nil {
		t.Fatalf("delegated revision returned %v", err)
	}
	if err := CheckCommand(run, "satisfy", "agent", true); !errors.Is(err, ErrHumanApproval) {
		t.Fatalf("delegated satisfaction returned %v", err)
	}
	if err := CheckCommand(run, "feedback", "user", false); err != nil {
		t.Fatal(err)
	}
	run.Value = json.RawMessage(`{"events":[{"kind":"feedback","by":"agent"},{"kind":"feedback","by":"user"},{"kind":"feedback","by":"agent"}]}`)
	if err := CheckCommand(run, "feedback", "agent", false); err != nil {
		t.Fatal(err)
	}
	// 위임 기록은 세지도 초기화하지도 않는다
	run.Value = json.RawMessage(`{"events":[{"kind":"feedback","by":"agent"},{"kind":"feedback","by":"agent","delegated":true},{"kind":"feedback","by":"agent"}]}`)
	if err := CheckCommand(run, "feedback", "agent", false); !errors.Is(err, ErrAgentFeedbackLimit) {
		t.Fatalf("delegated history reset the budget: %v", err)
	}
}
