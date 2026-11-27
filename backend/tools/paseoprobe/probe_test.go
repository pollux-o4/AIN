package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

const fixtureAgent = "9f8d63a7-7823-4e99-bf02-f6c1bc169c7b"

func TestMIG002ReconnectAndRelease(t *testing.T) {
	first := fixtureDaemon(t, func(conn *websocket.Conn) {
		request := readFixtureRequest(t, conn, "agent.timeline.set_subscription.request")
		fixtureReply(t, conn, "agent.timeline.set_subscription.response", map[string]any{
			"requestId": request["requestId"], "agentIds": []string{fixtureAgent}, "subscriptionId": "first",
		})
		fixtureReply(t, conn, "agent_stream", map[string]any{
			"agentId": fixtureAgent, "subscriptionId": "first", "epoch": "timeline-a", "seq": 41,
			"event":     map[string]any{"type": "timeline", "item": map[string]any{"type": "assistant_message", "text": "synthetic"}},
			"timestamp": "2026-01-01T00:00:00.000Z",
		})
		// The wire disappears before observing the final state.
	})
	second := fixtureDaemon(t, func(conn *websocket.Conn) {
		request := readFixtureRequest(t, conn, "agent.timeline.set_subscription.request")
		fixtureReply(t, conn, "agent.timeline.set_subscription.response", map[string]any{
			"requestId": request["requestId"], "agentIds": []string{fixtureAgent}, "subscriptionId": "second",
			"timelines": map[string]string{fixtureAgent: "behind"},
		})
		request = readFixtureRequest(t, conn, "fetch_agent_timeline_request")
		// A stale or unrelated reply has the right method and the wrong request ID.
		fixtureReply(t, conn, "fetch_agent_timeline_response", map[string]any{"requestId": "stale-reply"})
		// An event can carry the same ID but must never satisfy this RPC.
		fixtureReply(t, conn, "status", map[string]any{"requestId": request["requestId"], "status": "ignored"})
		fixtureReply(t, conn, "fetch_agent_timeline_response", map[string]any{
			"requestId": request["requestId"], "agentId": fixtureAgent, "agent": map[string]string{"status": "idle"},
			"direction": "tail", "projection": "projected", "epoch": "timeline-a",
			"reset": false, "staleCursor": false, "gap": false, "error": nil,
			"window": map[string]int{"minSeq": 40, "maxSeq": 42, "nextSeq": 43},
			"entries": []map[string]any{
				{"seqStart": 40, "seqEnd": 40, "turnId": "turn-b", "item": map[string]string{"type": "user_message", "messageId": "message-b"}},
				{"seqStart": 41, "seqEnd": 42, "turnId": "turn-b", "item": map[string]string{"type": "assistant_message", "text": "synthetic"}},
			},
		})
		request = readFixtureRequest(t, conn, "subscription.release.request")
		if request["subscriptionId"] != "second" {
			t.Error("the live subscription was not released")
		}
		fixtureReply(t, conn, "subscription.release.response", map[string]any{
			"requestId": request["requestId"], "subscriptionId": request["subscriptionId"],
		})
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	fields := map[string]any{"agentIds": []string{fixtureAgent}}
	client := openFixture(t, ctx, first)
	defer client.conn.Close()
	callFixture(t, client, "agent.timeline.set_subscription.request", "agent.timeline.set_subscription.response", fields)
	push, err := client.receive()
	if err != nil || push.Message == nil || push.Message.Type != "agent_stream" {
		t.Fatalf("read stream event: %v", err)
	}
	if _, err := client.receive(); err == nil {
		t.Fatal("expected disconnect before completion")
	}

	client = openFixture(t, ctx, second)
	defer client.conn.Close()
	subscription := callFixture(t, client, "agent.timeline.set_subscription.request", "agent.timeline.set_subscription.response", fields)
	payload := callFixture(t, client, "fetch_agent_timeline_request", "fetch_agent_timeline_response", map[string]any{
		"agentId": fixtureAgent, "direction": "tail", "projection": "canonical",
	})
	var snapshot struct {
		Agent      struct{ Status string } `json:"agent"`
		Epoch      string                  `json:"epoch"`
		Projection string                  `json:"projection"`
		Window     struct{ MaxSeq int }    `json:"window"`
	}
	if err := json.Unmarshal(payload, &snapshot); err != nil || snapshot.Agent.Status != "idle" ||
		snapshot.Epoch != "timeline-a" || snapshot.Window.MaxSeq != 42 || snapshot.Projection != "projected" {
		t.Fatal("the recovered snapshot did not match the wire fixture")
	}
	var active struct {
		SubscriptionID string `json:"subscriptionId"`
	}
	if err := json.Unmarshal(subscription, &active); err != nil {
		t.Fatal("invalid fixture subscription")
	}
	callFixture(t, client, "subscription.release.request", "subscription.release.response", map[string]any{
		"subscriptionId": active.SubscriptionID,
	})
}

func TestMIG002HelloRejection(t *testing.T) {
	for _, reason := range []helloRejection{"password_required", "incorrect_password", "incompatible_protocol"} {
		t.Run(string(reason), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				upgrader := websocket.Upgrader{}
				conn, err := upgrader.Upgrade(w, r, nil)
				if err != nil {
					t.Error("fixture upgrade failed")
					return
				}
				defer conn.Close()
				if !readFixtureHello(t, conn) {
					return
				}
				_ = conn.WriteJSON(map[string]any{"type": "hello.rejected", "reason": reason, "accepts": []string{"password"}})
			}))
			defer server.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			_, err := connect(ctx, fixtureTarget(server))
			if err != reason {
				t.Fatalf("expected %s, got %v", reason, err)
			}
		})
	}
}

func fixtureDaemon(t *testing.T, script func(*websocket.Conn)) *httptest.Server {
	t.Helper()
	done := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(done)
		upgrader := websocket.Upgrader{}
		if r.URL.Path != "/ws" || r.Header.Get("Authorization") != "" {
			t.Error("unexpected fixture Upgrade path or auth header")
			http.Error(w, "unexpected Upgrade", http.StatusBadRequest)
			return
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Error("fixture upgrade failed")
			return
		}
		defer conn.Close()
		_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		if !readFixtureHello(t, conn) {
			return
		}
		fixtureReply(t, conn, "status", map[string]any{"status": "server_info", "serverId": "test-server"})
		script(conn)
	}))
	t.Cleanup(func() {
		server.Close()
		select {
		case <-done:
		default:
		}
	})
	return server
}

func readFixtureHello(t *testing.T, conn *websocket.Conn) bool {
	t.Helper()
	var hello struct {
		Type         string                       `json:"type"`
		ClientType   string                       `json:"clientType"`
		ClientID     string                       `json:"clientId"`
		Version      int                          `json:"protocolVersion"`
		Capabilities map[string]bool              `json:"capabilities"`
		Auth         struct{ Kind, Token string } `json:"auth"`
	}
	if err := conn.ReadJSON(&hello); err != nil || hello.Type != "hello" || hello.ClientType != "cli" ||
		hello.ClientID == "" || hello.Version != 1 || !hello.Capabilities["hello_rejection"] ||
		hello.Auth.Kind != "localCredential" || hello.Auth.Token != "synthetic-credential" {
		t.Error("invalid fixture hello")
		return false
	}
	return true
}

func readFixtureRequest(t *testing.T, conn *websocket.Conn, requestType string) map[string]any {
	t.Helper()
	var frame struct {
		Type    string         `json:"type"`
		Message map[string]any `json:"message"`
	}
	if err := conn.ReadJSON(&frame); err != nil || frame.Type != "session" ||
		frame.Message["type"] != requestType || frame.Message["requestId"] == nil {
		t.Errorf("expected fixture request %s", requestType)
	}
	return frame.Message
}

func fixtureReply(t *testing.T, conn *websocket.Conn, kind string, payload map[string]any) {
	t.Helper()
	if err := conn.WriteJSON(map[string]any{
		"type": "session", "message": map[string]any{"type": kind, "payload": payload},
	}); err != nil {
		t.Errorf("write fixture reply %s: %v", kind, err)
	}
}

func fixtureTarget(server *httptest.Server) localTarget {
	return localTarget{address: strings.TrimPrefix(server.URL, "http://"), credential: "synthetic-credential"}
}

func openFixture(t *testing.T, ctx context.Context, server *httptest.Server) *wireClient {
	t.Helper()
	client, err := connect(ctx, fixtureTarget(server))
	if err != nil {
		t.Fatal(err)
	}
	return client
}

func callFixture(t *testing.T, client *wireClient, requestType, responseType string, args map[string]any) json.RawMessage {
	t.Helper()
	payload, err := client.request(requestType, responseType, args)
	if err != nil && err != io.EOF {
		t.Fatal(err)
	}
	return payload
}
