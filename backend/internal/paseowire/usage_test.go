package paseowire

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

func TestTypedUsageRequiresCurrentProvedPaseoTurn(t *testing.T) {
	for _, tc := range []struct {
		name, turn, provider string
		input, output        any
		expect               bool
	}{
		{name: "reported", turn: "native", provider: "claude", input: 0, output: 17, expect: true},
		{name: "wrong native turn", turn: "prior", provider: "claude", input: 50, output: 17},
		{name: "unverified provider", turn: "native", provider: "codex", input: 50, output: 17},
		{name: "partial report", turn: "native", provider: "claude", input: nil, output: 17},
		{name: "formatted report", turn: "native", provider: "claude", input: "1.2K", output: 17},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client := fakeDaemon(t, func(s *fixtureSocket) {
				s.hello()
				sub := s.request("agent.timeline.set_subscription.request")
				s.reply("agent.timeline.set_subscription.response", sub["requestId"], map[string]any{
					"agentIds": []string{fixtureAgent}, "subscriptionId": "watch",
				})
				first := s.request("fetch_agent_timeline_request")
				sendUsageProjection(s, first, "epoch", false)
				// The 0.17.5 live lifecycle envelope omits a timeline epoch and seq.
				s.reply("agent_stream", nil, map[string]any{
					"agentId": fixtureAgent, "subscriptionId": "watch", "event": map[string]any{
						"type": "turn_completed", "provider": tc.provider, "turnId": tc.turn,
						"usage": map[string]any{"inputTokens": tc.input, "outputTokens": tc.output},
					},
				})
				final := s.request("fetch_agent_timeline_request")
				sendUsageProjection(s, final, "epoch", true)
				release := s.request("subscription.release.request")
				s.reply("subscription.release.response", release["requestId"], map[string]any{"subscriptionId": "watch"})
			})
			ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
			defer cancel()
			done := errors.New("recorded terminal observation")
			err := client.Watch(ctx, contract.RemoteRef{AgentID: fixtureAgent, TurnID: fixtureMessage}, func(s contract.Snapshot) error {
				if s.Status != "completed" {
					if s.Usage != nil {
						t.Error("usage reached a running observation")
					}
					return nil
				}
				if tc.expect {
					if s.Usage == nil || s.Usage.InputTokens != 0 || s.Usage.OutputTokens != 17 {
						t.Errorf("exact usage missing: %#v", s.Usage)
					}
				} else if s.Usage != nil {
					t.Errorf("unconfirmed usage surfaced: %#v", s.Usage)
				}
				return done
			})
			if !errors.Is(err, done) {
				t.Fatalf("watch: %v", err)
			}
		})
	}
}

func TestReconnectDoesNotRecoverUsageFromAgentOrDisplayMetrics(t *testing.T) {
	var sockets atomic.Int32
	client := fakeDaemon(t, func(s *fixtureSocket) {
		s.hello()
		n := sockets.Add(1)
		sub := s.request("agent.timeline.set_subscription.request")
		s.reply("agent.timeline.set_subscription.response", sub["requestId"], map[string]any{
			"agentIds": []string{fixtureAgent}, "subscriptionId": "watch",
		})
		first := s.request("fetch_agent_timeline_request")
		sendUsageProjection(s, first, "epoch", n > 1)
		if n > 1 {
			release := s.request("subscription.release.request")
			s.reply("subscription.release.response", release["requestId"], map[string]any{"subscriptionId": "watch"})
		}
	})
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	done := errors.New("reconnected")
	err := client.Watch(ctx, contract.RemoteRef{AgentID: fixtureAgent, TurnID: fixtureMessage}, func(s contract.Snapshot) error {
		if s.Usage != nil {
			t.Error("reconnect inferred usage from agent state or footer")
		}
		if s.Status == "completed" {
			return done
		}
		return nil
	})
	if !errors.Is(err, done) || sockets.Load() != 2 {
		t.Fatalf("reconnect: %v (%d sockets)", err, sockets.Load())
	}
}

func sendUsageProjection(s *fixtureSocket, request map[string]any, epoch string, terminal bool) {
	agent := map[string]any{"id": fixtureAgent, "status": "running", "activeTurn": map[string]string{"turnId": "native"},
		"lastUsage": map[string]int{"inputTokens": 789, "outputTokens": 42}}
	entries := []any{map[string]any{"turnId": "native", "seqStart": 1, "seqEnd": 1,
		"item": map[string]string{"type": "user_message", "clientMessageId": fixtureMessage}}}
	maxSeq := 1
	if terminal {
		agent["status"], agent["activeTurn"] = "idle", nil
		maxSeq = 2
		entries = append(entries, map[string]any{
			"turnId": "native", "seqStart": 2, "seqEnd": 2,
			"turnMetrics": []map[string]string{{"label": "Tokens", "value": "789 ↑ · 42 ↓"}},
			"item":        map[string]string{"type": "assistant_message", "text": "confirmed result"},
		})
	}
	s.reply("fetch_agent_timeline_response", request["requestId"], map[string]any{
		"agentId": fixtureAgent, "agent": agent, "epoch": epoch, "projection": "projected",
		"window": map[string]int{"maxSeq": maxSeq}, "entries": entries, "error": nil,
	})
}
