package paseowire

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

func TestMIG013TimelineRequiresCurrentTurnProof(t *testing.T) {
	const (
		submitted = `{"turnId":"native","seqStart":2,"seqEnd":2,"item":{"type":"user_message","clientMessageId":"message"}}`
		proved    = `{"turnId":"native","seqStart":3,"seqEnd":3,"turnMetrics":[{"label":"Model","value":"synthetic"}],"item":{"type":"assistant_message","text":"result"}}`
		old       = `{"turnId":"old","seqStart":1,"seqEnd":1,"turnMetrics":[{"label":"Model","value":"synthetic"}],"item":{"type":"assistant_message","text":"stale"}}`
		later     = `{"turnId":"other","seqStart":4,"seqEnd":4,"item":{"type":"user_message","clientMessageId":"another"}}`
		partial   = `{"turnId":"native","seqStart":3,"seqEnd":3,"item":{"type":"assistant_message","text":"partial"}}`
	)
	for _, tc := range []struct {
		name, status, active, entries, wantStatus, wantTurn string
	}{
		{"matched footer", "idle", "null", old + "," + submitted + "," + proved, "completed", "message"},
		{"foreign footer", "idle", "null", old + "," + submitted + "," + partial, "idle", "message"},
		{"foreign active turn", "running", `{"turnId":"other"}`, submitted + "," + proved, "running", ""},
		{"later submission", "idle", "null", submitted + "," + proved + "," + later, "idle", ""},
		{"raw terminal spelling", "completed", "null", submitted + "," + partial, "unconfirmed", "message"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw := fmt.Appendf(nil, `{"agent":{"id":"agent","status":%q,"activeTurn":%s},"epoch":"e","window":{"maxSeq":4},"entries":[%s]}`,
				tc.status, tc.active, tc.entries)
			var page timeline
			if err := json.Unmarshal(raw, &page); err != nil {
				t.Fatal(err)
			}
			snapshot, err := page.project(contract.RemoteRef{AgentID: "agent", TurnID: "message"}, raw)
			if err != nil || snapshot.Status != tc.wantStatus || snapshot.Ref.TurnID != tc.wantTurn {
				t.Fatalf("status=%q, turn=%q, error=%v", snapshot.Status, snapshot.Ref.TurnID, err)
			}
		})
	}
}
