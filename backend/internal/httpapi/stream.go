package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// WriteActivity writes a stream of complete activity snapshots. The caller
// supplies a bounded subscription and releases it when this function returns.
func WriteActivity(w http.ResponseWriter, r *http.Request, snapshots <-chan json.RawMessage) {
	controller := http.NewResponseController(w)
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("X-Content-Type-Options", "nosniff")

	write := func(frame string) bool {
		_ = controller.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if _, err := fmt.Fprint(w, frame); err != nil {
			return false
		}
		return controller.Flush() == nil
	}
	if !write(": connected\n\n") {
		return
	}
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			if !write(": keepalive\n\n") {
				return
			}
		case snapshot, open := <-snapshots:
			if !open {
				return
			}
			if len(snapshot) > maxJSONBytes || !json.Valid(snapshot) {
				continue
			}
			// Marshal compacts RawMessage so the payload cannot introduce SSE lines.
			data, err := json.Marshal(snapshot)
			if err != nil || !write("event: activity\ndata: "+string(data)+"\n\n") {
				return
			}
		}
	}
}
