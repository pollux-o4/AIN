package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"time"

	"github.com/gorilla/websocket"
)

type envelope struct {
	Type    string           `json:"type"`
	Reason  string           `json:"reason"`
	Message *incomingMessage `json:"message"`
}

type incomingMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type wireClient struct {
	conn *websocket.Conn
}

func clientID() string {
	var id [16]byte
	_, err := rand.Read(id[:])
	if err != nil {
		panic(err)
	}
	id[6] = id[6]&15 | 64
	id[8] = id[8]&63 | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", id[:4], id[4:6], id[6:8], id[8:10], id[10:])
}

func connect(ctx context.Context, target localTarget) (*wireClient, error) {
	endpoint := url.URL{Scheme: "ws", Host: target.address, Path: "/ws"}
	dialer := websocket.Dialer{
		HandshakeTimeout: 3 * time.Second,
		NetDialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			var dialer net.Dialer
			host, port, err := net.SplitHostPort(address)
			if err != nil || host != "localhost" {
				return dialer.DialContext(ctx, network, address)
			}
			conn, err := dialer.DialContext(ctx, network, net.JoinHostPort("127.0.0.1", port))
			if err == nil {
				return conn, nil
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort("::1", port))
		},
	}
	conn, response, err := dialer.DialContext(ctx, endpoint.String(), nil)
	if err != nil {
		if response != nil {
			return nil, fmt.Errorf("Paseo WebSocket upgrade failed (HTTP %d)", response.StatusCode)
		}
		return nil, errors.New("Paseo WebSocket connection failed")
	}
	conn.SetReadLimit(4 << 20)
	if deadline, ok := ctx.Deadline(); ok {
		if conn.SetReadDeadline(deadline) != nil || conn.SetWriteDeadline(deadline) != nil {
			_ = conn.Close()
			return nil, errors.New("cannot set Paseo WebSocket deadline")
		}
	}
	client := &wireClient{conn: conn}
	if err := client.hello(target.credential); err != nil {
		_ = conn.Close()
		return nil, err
	}
	return client, nil
}

func (client *wireClient) hello(credential string) error {
	hello := map[string]any{
		"type": "hello", "clientId": clientID(), "clientType": "cli", "protocolVersion": 1,
		"sessionPermissions": []string{"workspace.read"},
		"capabilities": map[string]bool{
			"hello_rejection": true, "selective_agent_timeline": true,
			"explicit_event_subscriptions": true, "owned_subscriptions": true,
		},
	}
	if credential != "" {
		hello["auth"] = map[string]string{"kind": "localCredential", "token": credential}
	}
	if client.conn.WriteJSON(hello) != nil {
		return errors.New("Paseo hello write failed")
	}
	for {
		msg, err := client.receive()
		if err != nil {
			return fmt.Errorf("Paseo hello: %w", err)
		}
		if msg.Type == "hello.rejected" {
			return helloRejection(msg.Reason)
		}
		if msg.Type != "session" || msg.Message.Type != "status" {
			continue
		}
		var status struct {
			Status   string `json:"status"`
			ServerID string `json:"serverId"`
		}
		if json.Unmarshal(msg.Message.Payload, &status) == nil && status.Status == "server_info" {
			if status.ServerID == "" {
				return errors.New("Paseo server_info is missing server identity")
			}
			return nil
		}
	}
}

type helloRejection string

func (reason helloRejection) Error() string {
	switch reason {
	case "password_required", "incorrect_password", "incompatible_protocol":
		return "Paseo hello rejected (" + string(reason) + ")"
	default:
		return "Paseo hello rejected (unknown reason)"
	}
}

func (client *wireClient) receive() (envelope, error) {
	var msg envelope
	if client.conn.ReadJSON(&msg) != nil {
		return envelope{}, errors.New("WebSocket closed, timed out, or returned an invalid message")
	}
	if msg.Type == "session" && msg.Message == nil {
		return envelope{}, errors.New("invalid session envelope")
	}
	return msg, nil
}

// request is used serially by the probe. Unsolicited events and other RPC replies
// cannot satisfy the current call.
func (client *wireClient) request(requestType, responseType string, fields map[string]any) (json.RawMessage, error) {
	requestID := clientID()
	message := map[string]any{"type": requestType, "requestId": requestID}
	for key, value := range fields {
		message[key] = value
	}
	if client.conn.WriteJSON(map[string]any{"type": "session", "message": message}) != nil {
		return nil, errors.New("Paseo request write failed")
	}
	for {
		msg, err := client.receive()
		if err != nil {
			return nil, err
		}
		if msg.Type != "session" || msg.Message.Type != responseType {
			continue
		}
		var reply struct {
			RequestID string `json:"requestId"`
		}
		if json.Unmarshal(msg.Message.Payload, &reply) == nil && reply.RequestID == requestID {
			return msg.Message.Payload, nil
		}
	}
}

func probe(ctx context.Context, target localTarget) error {
	client, err := connect(ctx, target)
	if err != nil {
		return err
	}
	defer client.conn.Close()

	// A fresh UUID exercises exact lookup without reading real agent content.
	payload, err := client.request("fetch_agent_request", "fetch_agent_response", map[string]any{"agentId": clientID()})
	if err != nil {
		return fmt.Errorf("Paseo read-only lookup: %w", err)
	}
	var lookup struct {
		Agent json.RawMessage `json:"agent"`
		Error json.RawMessage `json:"error"`
	}
	if json.Unmarshal(payload, &lookup) != nil || !bytes.Equal(lookup.Agent, []byte("null")) || !bytes.Equal(lookup.Error, []byte("null")) {
		return errors.New("Paseo read-only lookup did not return an absent agent")
	}
	return nil
}
