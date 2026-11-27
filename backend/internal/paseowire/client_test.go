package paseowire

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pollux-o4/AIN/backend/internal/contract"
)

const fixtureAgent = "9f8d63a7-7823-4e99-bf02-f6c1bc169c7b"
const fixtureMessage = "persisted-message"

func TestMIG013MutationCorrelationAndLostAcknowledgement(t *testing.T) {
	var calls atomic.Int32
	client := fakeDaemon(t, func(s *fixtureSocket) {
		s.hello()
		switch calls.Add(1) {
		case 1:
			req := s.request("agent.create.request")
			if req["agentId"] != fixtureAgent || req["idempotencyKey"] != fixtureAgent || req["clientMessageId"] != fixtureAgent {
				t.Error("creation lacks stable IDs")
			}
			s.reply("agent.create.response", "other-request", map[string]any{"agent": nil})
			s.reply("status", req["requestId"], map[string]any{"status": "agent_created"})
			s.reply("agent.create.response", req["requestId"], map[string]any{"agent": map[string]string{"id": fixtureAgent}, "error": nil})
		case 2:
			req := s.request("send_agent_message_request")
			if req["messageId"] != fixtureMessage {
				t.Error("send replaced the caller's persisted message ID")
			}
			// Drop the connection after accepting the frame and before writing the response.
		case 3:
			req := s.request("cancel_agent_request")
			s.reply("cancel_agent_response", req["requestId"], map[string]any{"agentId": fixtureAgent, "agent": nil})
		case 4:
			req := s.request("archive_agent_request")
			s.reply("agent_archived", req["requestId"], map[string]any{"agentId": fixtureAgent, "archivedAt": "2026-01-01T00:00:00.000Z"})
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	ref, err := client.Create(ctx, fixtureAgent, contract.SessionSpec{Provider: "codex", WorkDir: "/synthetic", Prompt: "fixture"})
	if err != nil || ref.AgentID != fixtureAgent || ref.TurnID != fixtureAgent {
		t.Fatalf("create returned %v, %v", ref, err)
	}
	ref.TurnID = fixtureMessage
	if err := client.Send(ctx, ref, "fixture"); !errors.Is(err, contract.ErrDeliveryUncertain) {
		t.Fatalf("send acknowledged a lost response: %v", err)
	}
	if err := client.Cancel(ctx, ref); err != nil {
		t.Fatal(err)
	}
	if err := client.Archive(ctx, ref); err != nil {
		t.Fatal(err)
	}
}

func TestMIG013WatchReconnectAndRelease(t *testing.T) {
	var connections atomic.Int32
	released := make(chan struct{})
	stopWatch := errors.New("snapshot recovered")
	client := fakeDaemon(t, func(s *fixtureSocket) {
		s.hello()
		n := connections.Add(1)
		request := s.request("agent.timeline.set_subscription.request")
		sub := "first"
		if n == 2 {
			sub = "second"
			cursors, _ := request["cursors"].(map[string]any)
			cursor, _ := cursors[fixtureAgent].(map[string]any)
			if cursor["epoch"] != "a" || cursor["seq"] != float64(10) {
				t.Error("subscription did not recover from the last emitted cursor")
			}
		}
		s.reply("agent.timeline.set_subscription.response", request["requestId"], map[string]any{
			"agentIds": []string{fixtureAgent}, "subscriptionId": sub,
		})
		request = s.request("fetch_agent_timeline_request")
		if n == 1 {
			s.snapshot(request, "a", "running", 10, false)
			s.reply("agent_stream", nil, map[string]any{
				"agentId": fixtureAgent, "subscriptionId": sub, "epoch": "a", "seq": 9,
			})
			return
		}
		s.snapshot(request, "b", "idle", 2, true)
		request = s.request("subscription.release.request")
		if request["subscriptionId"] != sub {
			t.Error("watch released the wrong subscription")
		}
		s.reply("subscription.release.response", request["requestId"], map[string]any{"subscriptionId": sub})
		close(released)
	})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var seen int
	err := client.Watch(ctx, contract.RemoteRef{AgentID: fixtureAgent, TurnID: fixtureMessage}, func(s contract.Snapshot) error {
		seen++
		switch seen {
		case 1:
			if s.Ref.Epoch != "a" || s.Ref.After != 10 || s.Ref.TurnID != "" || s.Status != "running" {
				t.Errorf("unexpected first watch snapshot: %v", s.Ref)
			}
			return nil
		case 2:
			if s.Ref.Epoch != "b" || s.Ref.After != 2 || s.Ref.TurnID != fixtureMessage || s.Status != "idle" {
				t.Errorf("unexpected recovered watch snapshot: %v", s.Ref)
			}
			return stopWatch
		default:
			t.Error("watch received extra snapshots")
			return stopWatch
		}
	})
	if !errors.Is(err, stopWatch) || seen != 2 {
		t.Fatalf("watch did not recover: %v", err)
	}
	select {
	case <-released:
	case <-ctx.Done():
		t.Fatal("release not observed")
	}
}

func TestMIG013WatchIgnoresOldEvents(t *testing.T) {
	watch := observeState{agentID: fixtureAgent, subscriptionID: "live", cursor: contract.RemoteRef{Epoch: "epoch", After: 10}}
	for _, event := range []struct {
		subscription string
		seq          int
	}{
		{"live", 9},
		{"live", 10},
		{"closed", 11},
	} {
		payload, _ := json.Marshal(map[string]any{
			"agentId": fixtureAgent, "subscriptionId": event.subscription, "epoch": "epoch", "seq": event.seq,
		})
		watch.event("agent_stream", payload)
		if watch.dirty {
			t.Fatal("stale event triggered refresh")
		}
	}
	payload, _ := json.Marshal(map[string]any{
		"agentId": fixtureAgent, "subscriptionId": "live", "epoch": "new", "seq": 1,
	})
	watch.event("agent.timeline.replacement", payload)
	if !watch.dirty {
		t.Fatal("epoch replacement must trigger refresh")
	}
}

func TestMIG013Admission(t *testing.T) {
	client := fakeDaemon(t, func(s *fixtureSocket) {
		var hello map[string]any
		if s.conn.ReadJSON(&hello) != nil {
			t.Error("cannot read fixture hello")
			return
		}
		_ = s.conn.WriteJSON(map[string]any{"type": "hello.rejected", "reason": "incorrect_password"})
	})
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, err := client.Probe(ctx)
	if !errors.Is(err, AdmissionError("incorrect_password")) {
		t.Fatalf("authentication stage was lost: %v", err)
	}
}

type fixtureSocket struct {
	t    *testing.T
	conn *websocket.Conn
}

func (s *fixtureSocket) hello() {
	var message struct {
		Type            string                       `json:"type"`
		ProtocolVersion int                          `json:"protocolVersion"`
		Auth            struct{ Kind, Token string } `json:"auth"`
	}
	if s.conn.ReadJSON(&message) != nil || message.Type != "hello" || message.ProtocolVersion != 1 ||
		message.Auth.Kind != "localCredential" || message.Auth.Token != strings.Repeat("x", 43) {
		s.t.Error("invalid local hello")
	}
	s.reply("status", nil, map[string]any{"status": "server_info", "serverId": "fixture", "protocolVersion": 1})
}

func (s *fixtureSocket) request(kind string) map[string]any {
	var frame struct {
		Type    string         `json:"type"`
		Message map[string]any `json:"message"`
	}
	if s.conn.ReadJSON(&frame) != nil || frame.Type != "session" || frame.Message["type"] != kind || frame.Message["requestId"] == "" {
		s.t.Errorf("invalid %s request", kind)
	}
	return frame.Message
}

func (s *fixtureSocket) reply(kind string, key any, payload map[string]any) {
	if key != nil {
		payload["requestId"] = key
	}
	if s.conn.WriteJSON(map[string]any{"type": "session", "message": map[string]any{"type": kind, "payload": payload}}) != nil {
		s.t.Errorf("cannot write %s", kind)
	}
}

func (s *fixtureSocket) snapshot(request map[string]any, epoch, status string, seq int, includeMessage bool) {
	entries := []any{}
	if includeMessage {
		entries = append(entries, map[string]any{"turnId": "daemon-turn", "item": map[string]string{
			"type": "user_message", "clientMessageId": fixtureMessage,
		}})
	}
	s.reply("fetch_agent_timeline_response", request["requestId"], map[string]any{
		"agentId": fixtureAgent, "agent": map[string]string{"id": fixtureAgent, "status": status},
		"epoch": epoch, "projection": "projected", "window": map[string]int{"maxSeq": seq}, "entries": entries, "error": nil,
	})
}

func fakeDaemon(t *testing.T, script func(*fixtureSocket)) *Client {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upgrader := websocket.Upgrader{}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Error("fixture upgrade failed")
			return
		}
		defer conn.Close()
		_ = conn.SetReadDeadline(time.Now().Add(time.Second))
		script(&fixtureSocket{t: t, conn: conn})
	}))
	t.Cleanup(server.Close)
	home := t.TempDir()
	address := strings.TrimPrefix(server.URL, "http://")
	config, _ := json.Marshal(map[string]any{"daemon": map[string]string{"listen": address}})
	lock, _ := json.Marshal(map[string]string{"listen": address})
	for file, data := range map[string][]byte{"config.json": config, "paseo.pid": lock, "local-credential": []byte(strings.Repeat("x", 43))} {
		if err := os.WriteFile(filepath.Join(home, file), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	return New(home)
}
