package httpapi

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLIVE001ActivityFrame(t *testing.T) {
	snapshots := make(chan json.RawMessage, 3)
	snapshots <- json.RawMessage("not JSON")
	snapshots <- json.RawMessage(strings.Repeat(" ", maxJSONBytes+1))
	snapshots <- json.RawMessage("{\n \"text\": \"line\\nnext\",\n \"revision\": 2\n}")
	close(snapshots)

	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/write/api/runs/example/activity", nil)
	WriteActivity(w, r, snapshots)

	if got := w.Header().Get("Content-Type"); got != "text/event-stream; charset=utf-8" {
		t.Errorf("Content-Type = %q", got)
	}
	const want = ": connected\n\nevent: activity\ndata: {\"text\":\"line\\nnext\",\"revision\":2}\n\n"
	if got := w.Body.String(); got != want {
		t.Errorf("unexpected event stream: %q", got)
	}
	if !w.Flushed {
		t.Error("activity frames must be flushed")
	}
}
