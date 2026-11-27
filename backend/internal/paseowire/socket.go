package paseowire

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pollux-o4/AIN/backend/internal/contract"
)

const (
	rpcTimeout      = 15 * time.Second
	maxMessageBytes = 8 << 20
)

var (
	errTransport = errors.New("Paseo transport interrupted")
	errProtocol  = errors.New("invalid Paseo protocol reply")
)

type AdmissionError string

func (e AdmissionError) Error() string {
	switch e {
	case "password_required", "incorrect_password", "incompatible_protocol":
		return "Paseo admission rejected (" + string(e) + ")"
	default:
		return "Paseo admission rejected"
	}
}

type socket struct {
	conn    *websocket.Conn
	stop    func() bool
	info    json.RawMessage
	onEvent func(string, json.RawMessage)
}

type frame struct {
	Type    string `json:"type"`
	Reason  string `json:"reason"`
	Message *struct {
		Type    string          `json:"type"`
		Payload json.RawMessage `json:"payload"`
	} `json:"message"`
}

func id() string {
	var value [16]byte
	_, _ = rand.Read(value[:])
	value[6] = value[6]&15 | 64
	value[8] = value[8]&63 | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", value[:4], value[4:6], value[6:8], value[8:10], value[10:])
}

func connect(ctx context.Context, target localTarget, permissions []string) (*socket, error) {
	endpoint := url.URL{Scheme: "ws", Host: target.address, Path: "/ws"}
	dialer := websocket.Dialer{HandshakeTimeout: 3 * time.Second, NetDialContext: dialLoopback}
	conn, response, err := dialer.DialContext(ctx, endpoint.String(), nil)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if response != nil {
			defer response.Body.Close()
			return nil, fmt.Errorf("%w: HTTP upgrade status %d", errTransport, response.StatusCode)
		}
		return nil, errTransport
	}
	conn.SetReadLimit(maxMessageBytes)
	peer := &socket{conn: conn, stop: context.AfterFunc(ctx, func() { _ = conn.Close() })}
	if err := peer.hello(permissions, target.credential); err != nil {
		peer.close()
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, err
	}
	return peer, nil
}

func dialLoopback(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	var dialer net.Dialer
	if host == "localhost" {
		conn, err := dialer.DialContext(ctx, network, net.JoinHostPort("127.0.0.1", port))
		if err == nil {
			return conn, nil
		}
		return dialer.DialContext(ctx, network, net.JoinHostPort("::1", port))
	}
	if parsed := net.ParseIP(host); parsed == nil || !parsed.IsLoopback() {
		return nil, errors.New("Paseo address is not loopback")
	}
	return dialer.DialContext(ctx, network, address)
}

func (s *socket) close() {
	s.stop()
	_ = s.conn.Close()
}

func (s *socket) hello(permissions []string, token string) error {
	hello := map[string]any{
		"type": "hello", "clientId": id(), "clientType": "cli", "protocolVersion": 1,
		"sessionPermissions": permissions,
		"auth":               map[string]string{"kind": "localCredential", "token": token},
		"capabilities": map[string]bool{
			"hello_rejection": true, "selective_agent_timeline": true, "explicit_event_subscriptions": true,
			"owned_subscriptions": true, "all_providers": true, "timeline_replacement_invalidation": true,
		},
	}
	s.deadline(5 * time.Second)
	if s.conn.WriteJSON(hello) != nil {
		return errTransport
	}
	for {
		f, err := s.receive()
		if err != nil {
			return err
		}
		if f.Type == "hello.rejected" {
			return AdmissionError(f.Reason)
		}
		if f.Type != "session" || f.Message.Type != "status" {
			continue
		}
		var status struct {
			Status   string `json:"status"`
			ServerID string `json:"serverId"`
			Version  *int   `json:"protocolVersion"`
		}
		if json.Unmarshal(f.Message.Payload, &status) != nil || status.Status != "server_info" {
			continue
		}
		if status.Version != nil && *status.Version != 1 {
			return AdmissionError("incompatible_protocol")
		}
		if status.ServerID == "" {
			return errProtocol
		}
		s.info = f.Message.Payload
		return nil
	}
}

func (s *socket) deadline(timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	_ = s.conn.SetReadDeadline(deadline)
	_ = s.conn.SetWriteDeadline(deadline)
}

func (s *socket) receive() (frame, error) {
	var f frame
	kind, data, err := s.conn.ReadMessage()
	if err != nil {
		return frame{}, errTransport
	}
	if kind != websocket.TextMessage || json.Unmarshal(data, &f) != nil ||
		(f.Type == "session" && (f.Message == nil || f.Message.Type == "")) {
		return frame{}, errProtocol
	}
	return f, nil
}

func (s *socket) request(ctx context.Context, requestType, responseType string, args map[string]any, mutation bool) (json.RawMessage, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	key := id()
	msg := map[string]any{"type": requestType, "requestId": key}
	for field, value := range args {
		msg[field] = value
	}
	data, err := json.Marshal(map[string]any{"type": "session", "message": msg})
	if err != nil {
		return nil, errProtocol
	}
	failure := func(err error) error {
		if ctx.Err() != nil {
			err = ctx.Err()
		}
		if mutation {
			return errors.Join(contract.ErrDeliveryUncertain, err)
		}
		return err
	}
	s.deadline(rpcTimeout)
	if s.conn.WriteMessage(websocket.TextMessage, data) != nil {
		return nil, failure(errTransport)
	}
	for {
		f, err := s.receive()
		if err != nil {
			return nil, failure(err)
		}
		if f.Type != "session" {
			continue
		}
		payload := f.Message.Payload
		var identity struct {
			RequestID   string `json:"requestId"`
			RequestType string `json:"requestType"`
			Code        string `json:"code"`
		}
		if f.Message.Type == responseType || f.Message.Type == "rpc_error" {
			if json.Unmarshal(payload, &identity) != nil {
				return nil, failure(errProtocol)
			}
			if identity.RequestID == key {
				if f.Message.Type == responseType {
					return payload, nil
				}
				if identity.RequestType != "" && identity.RequestType != requestType {
					return nil, failure(errProtocol)
				}
				return nil, failure(errors.New("Paseo rejected the request"))
			}
		}
		if s.onEvent != nil {
			s.onEvent(f.Message.Type, payload)
		}
	}
}
