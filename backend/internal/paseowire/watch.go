package paseowire

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

const snapshotPageSize = 100

type timeline struct {
	AgentID    string  `json:"agentId"`
	Epoch      string  `json:"epoch"`
	Projection string  `json:"projection"`
	Error      *string `json:"error"`
	Agent      *struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	} `json:"agent"`
	Window *struct {
		MaxSeq int64 `json:"maxSeq"`
	} `json:"window"`
	Entries []struct {
		TurnID string `json:"turnId"`
		Item   struct {
			Type            string `json:"type"`
			ClientMessageID string `json:"clientMessageId"`
			MessageID       string `json:"messageId"`
		} `json:"item"`
	} `json:"entries"`
}

func (c *Client) Snapshot(ctx context.Context, ref contract.RemoteRef) (contract.Snapshot, error) {
	s, err := c.open(ctx, readPermissions)
	if err != nil {
		return contract.Snapshot{}, err
	}
	defer s.close()
	return s.snapshot(ctx, ref)
}

func (s *socket) snapshot(ctx context.Context, ref contract.RemoteRef) (contract.Snapshot, error) {
	if ref.AgentID == "" {
		return contract.Snapshot{}, errors.New("Paseo snapshot requires an agent ID")
	}
	payload, err := s.request(ctx, "fetch_agent_timeline_request", "fetch_agent_timeline_response", map[string]any{
		"agentId": ref.AgentID, "direction": "tail", "projection": "projected",
		"limit": snapshotPageSize, "wholeTurns": true,
	}, false)
	if err != nil {
		return contract.Snapshot{}, err
	}
	var page timeline
	if json.Unmarshal(payload, &page) != nil || page.AgentID != ref.AgentID {
		return contract.Snapshot{}, errProtocol
	}
	if page.Error != nil || page.Agent == nil {
		// Only the exact agent lookup can distinguish absent from failed history loading.
		return contract.Snapshot{}, s.checkAbsent(ctx, ref.AgentID)
	}
	if page.Agent.ID != ref.AgentID || page.Agent.Status == "" || page.Epoch == "" ||
		page.Window == nil || page.Window.MaxSeq < 0 || page.Projection != "projected" {
		return contract.Snapshot{}, errProtocol
	}
	current := contract.RemoteRef{AgentID: ref.AgentID, Epoch: page.Epoch, After: page.Window.MaxSeq}
	for _, entry := range page.Entries {
		if ref.TurnID != "" && entry.Item.Type == "user_message" && entry.TurnID != "" &&
			(entry.Item.ClientMessageID == ref.TurnID || entry.Item.MessageID == ref.TurnID) {
			current.TurnID = ref.TurnID
			break
		}
	}
	return contract.Snapshot{Ref: current, Status: page.Agent.Status, Body: payload}, nil
}

func (s *socket) checkAbsent(ctx context.Context, agentID string) error {
	payload, err := s.request(ctx, "fetch_agent_request", "fetch_agent_response", map[string]any{"agentId": agentID}, false)
	if err != nil {
		return err
	}
	var lookup struct {
		Agent json.RawMessage `json:"agent"`
		Error json.RawMessage `json:"error"`
	}
	if json.Unmarshal(payload, &lookup) != nil {
		return errProtocol
	}
	if string(lookup.Agent) == "null" && string(lookup.Error) == "null" {
		return contract.ErrNotFound
	}
	return errors.New("Paseo agent timeline is unavailable")
}

type observeState struct {
	agentID        string
	subscriptionID string
	cursor         contract.RemoteRef
	dirty          bool
}

func (o *observeState) event(kind string, body json.RawMessage) {
	if kind != "agent_stream" && kind != "agent.timeline.replacement" {
		return
	}
	var event struct {
		AgentID        string `json:"agentId"`
		SubscriptionID string `json:"subscriptionId"`
		Epoch          string `json:"epoch"`
		Seq            *int64 `json:"seq"`
	}
	if json.Unmarshal(body, &event) != nil || event.AgentID != o.agentID ||
		(o.subscriptionID != "" && event.SubscriptionID != o.subscriptionID) {
		return
	}
	if event.Seq == nil || event.Epoch != o.cursor.Epoch || *event.Seq > o.cursor.After {
		o.dirty = true
	}
}

// Watch calls emit serially. The socket read limit and a single pending snapshot
// coalesce bursts while the subscriber handles a snapshot. A callback must
// return promptly or honour cancellation via the caller's context.
func (c *Client) Watch(ctx context.Context, ref contract.RemoteRef, emit func(contract.Snapshot) error) error {
	if ref.AgentID == "" || emit == nil {
		return errors.New("Paseo watch requires an agent ID and callback")
	}
	observe := &observeState{agentID: ref.AgentID, cursor: ref}
	backoff := 100 * time.Millisecond
	for {
		connected, err := c.watchOnce(ctx, ref, observe, emit)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if !errors.Is(err, errTransport) {
			return err
		}
		if connected {
			backoff = 100 * time.Millisecond
		}
		timer := time.NewTimer(backoff)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
		backoff = min(backoff*2, 2*time.Second)
	}
}

func (c *Client) watchOnce(ctx context.Context, ref contract.RemoteRef, observe *observeState, emit func(contract.Snapshot) error) (bool, error) {
	s, err := c.open(ctx, readPermissions)
	if err != nil {
		return false, err
	}
	defer s.close()
	observe.subscriptionID = ""
	observe.dirty = false
	s.onEvent = observe.event
	args := map[string]any{"agentIds": []string{ref.AgentID}}
	if observe.cursor.Epoch != "" {
		args["cursors"] = map[string]any{ref.AgentID: map[string]any{"epoch": observe.cursor.Epoch, "seq": observe.cursor.After}}
	}
	payload, err := s.request(ctx, "agent.timeline.set_subscription.request", "agent.timeline.set_subscription.response", args, false)
	if err != nil {
		return false, err
	}
	var subscription struct {
		ID       string   `json:"subscriptionId"`
		AgentIDs []string `json:"agentIds"`
	}
	if json.Unmarshal(payload, &subscription) != nil || subscription.ID == "" ||
		len(subscription.AgentIDs) != 1 || subscription.AgentIDs[0] != ref.AgentID {
		return false, errProtocol
	}
	observe.subscriptionID = subscription.ID
	// On cancellation/disconnect the daemon drops ownership with the socket.
	// When the callback completes an open observation, release it explicitly.
	defer func() {
		if ctx.Err() == nil {
			cleanup, cancel := context.WithTimeout(ctx, 300*time.Millisecond)
			defer cancel()
			stop := context.AfterFunc(cleanup, func() { _ = s.conn.Close() })
			defer stop()
			_, _ = s.request(cleanup, "subscription.release.request", "subscription.release.response",
				map[string]any{"subscriptionId": subscription.ID}, false)
		}
	}()

	for {
		observe.dirty = false
		snapshot, err := s.snapshot(ctx, ref)
		if err != nil {
			return false, err
		}
		observe.cursor = snapshot.Ref
		if err := emit(snapshot); err != nil {
			return true, err
		}
		for !observe.dirty {
			s.deadline(30 * time.Second)
			frame, err := s.receive()
			if err != nil {
				return true, err
			}
			if frame.Type == "session" {
				observe.event(frame.Message.Type, frame.Message.Payload)
			}
		}
	}
}
