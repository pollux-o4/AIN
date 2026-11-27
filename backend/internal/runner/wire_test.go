package runner

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pollux-o4/AIN/backend/internal/paseowire"
)

func TestMIG012PaseoWireRecoveryCommitsOnlyProvedTurn(t *testing.T) {
	store := newTestStore("article")
	var proved atomic.Bool
	var creates atomic.Int32
	watched := make(chan struct{}, 1)
	client := wireFixture(t, func(socket *websocket.Conn, msg map[string]any) bool {
		requestID := msg["requestId"]
		switch msg["type"] {
		case "agent.create.request":
			creates.Add(1)
			intent, err := store.currentIntent("article")
			planned, decodeErr := decodeAction(intent)
			if err != nil || decodeErr != nil || msg["clientMessageId"] != planned.MessageID ||
				msg["agentId"] != intent.AgentID || intent.Remote.AgentID != "" {
				t.Error("wire destination and message identity were not durable before create")
			}
			return false // the daemon accepted creation before losing the acknowledgement
		case "agent.timeline.set_subscription.request":
			wireReply(t, socket, "agent.timeline.set_subscription.response", map[string]any{
				"requestId": requestID, "agentIds": msg["agentIds"], "subscriptionId": "fixture",
			})
			select {
			case watched <- struct{}{}:
			default:
			}
		case "fetch_agent_timeline_request":
			intent, err := store.currentIntent("article")
			if err != nil {
				return false
			}
			planned, err := decodeAction(intent)
			if err != nil {
				t.Error(err)
				return false
			}
			entries := []any{
				wireEntry(2, "old-turn", "assistant_message", "stale response", "", true),
				wireEntry(3, "native-turn", "user_message", "", planned.MessageID, false),
				wireEntry(4, "native-turn", "assistant_message", "exact response", "", proved.Load()),
			}
			wireReply(t, socket, "fetch_agent_timeline_response", map[string]any{
				"requestId": requestID, "agentId": msg["agentId"], "epoch": "known-epoch", "error": nil,
				"window": map[string]int{"maxSeq": 4}, "projection": "projected", "entries": entries,
				"agent": map[string]any{"id": msg["agentId"], "status": "idle", "activeTurn": nil},
			})
		default:
			t.Errorf("unexpected wire operation %v", msg["type"])
			return false
		}
		return true
	})
	tick, tickWaiting := make(chan time.Time, 1), make(chan struct{}, 4)
	r := newTestRunner(t, store, client, func(cfg *Config) {
		cfg.After = func(time.Duration) <-chan time.Time {
			tickWaiting <- struct{}{}
			return tick
		}
	})
	stop := launch(t, r)
	defer stop()
	receive(t, watched)
	receive(t, tickWaiting)
	if store.commitCount.Load() != 0 {
		t.Fatal("idle agent and partial assistant text bypassed completion proof")
	}
	proved.Store(true)
	tick <- time.Time{}
	result := receive(t, store.committed)
	var body struct {
		DaemonTurnID string `json:"daemonTurnId"`
		Text         string `json:"text"`
	}
	if err := json.Unmarshal(result.Value, &body); err != nil || body.DaemonTurnID != "native-turn" || body.Text != "exact response" {
		t.Fatal("wire snapshot did not isolate the exact proved turn")
	}
	stop()
	if creates.Load() != 1 || store.commitCount.Load() != 1 {
		t.Fatal("wire recovery replayed delivery or reapplied completion")
	}
}

func wireEntry(seq int, turn, kind, text, messageID string, terminal bool) map[string]any {
	entry := map[string]any{
		"seqStart": seq, "seqEnd": seq, "turnId": turn,
		"item": map[string]string{"type": kind, "text": text, "clientMessageId": messageID},
	}
	if terminal {
		entry["turnMetrics"] = []map[string]string{{"label": "Model", "value": "synthetic"}}
	}
	return entry
}

func wireFixture(t *testing.T, handle func(*websocket.Conn, map[string]any) bool) *paseowire.Client {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upgrader := websocket.Upgrader{}
		socket, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer socket.Close()
		var hello struct{ Type string }
		if socket.ReadJSON(&hello) != nil || hello.Type != "hello" {
			t.Error("wire fixture expected hello")
			return
		}
		wireReply(t, socket, "status", map[string]any{"status": "server_info", "serverId": "fixture", "protocolVersion": 1})
		for {
			var frame struct {
				Message map[string]any
			}
			if socket.ReadJSON(&frame) != nil || !handle(socket, frame.Message) {
				return
			}
		}
	}))
	t.Cleanup(server.Close)
	address := strings.TrimPrefix(server.URL, "http://")
	home := t.TempDir()
	config, _ := json.Marshal(map[string]any{"daemon": map[string]string{"listen": address}})
	lock, _ := json.Marshal(map[string]string{"listen": address})
	for path, body := range map[string][]byte{
		"config.json": config, "paseo.pid": lock, "local-credential": []byte(strings.Repeat("x", 43)),
	} {
		if err := os.WriteFile(filepath.Join(home, path), body, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return paseowire.New(home)
}

func wireReply(t *testing.T, socket *websocket.Conn, kind string, payload map[string]any) {
	t.Helper()
	if err := socket.WriteJSON(map[string]any{
		"type": "session", "message": map[string]any{"type": kind, "payload": payload},
	}); err != nil {
		t.Errorf("write wire fixture %s: %v", kind, err)
	}
}
