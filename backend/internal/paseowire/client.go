package paseowire

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

// Client connects directly to the workstation daemon. Each operation owns its
// socket, so a blocked watcher cannot delay mutations or another watcher.
type Client struct {
	home string
}

var _ contract.Paseo = (*Client)(nil)

var (
	readPermissions   = []string{"workspace.read"}
	writePermissions  = []string{"workspace.read", "workspace.write"}
	daemonPermissions = []string{"daemon.read"}
	uuidPattern       = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
)

// New uses the same Paseo home as the workstation launcher.
func New(home string) *Client {
	return &Client{home: home}
}

func (c *Client) open(ctx context.Context, permissions []string) (*socket, error) {
	// Reload on every new connection because daemon restart rotates credentials.
	target, err := loadLocalTarget(c.home)
	if err != nil {
		return nil, err
	}
	return connect(ctx, target, permissions)
}

func (c *Client) Probe(ctx context.Context) (json.RawMessage, error) {
	s, err := c.open(ctx, readPermissions)
	if err != nil {
		return nil, err
	}
	defer s.close()
	return s.info, nil
}

func (c *Client) call(ctx context.Context, permissions []string, request, response string, args map[string]any, mutation bool) (json.RawMessage, error) {
	s, err := c.open(ctx, permissions)
	if err != nil {
		return nil, err
	}
	defer s.close()
	return s.request(ctx, request, response, args, mutation)
}

func (c *Client) Providers(ctx context.Context, cwd string) (json.RawMessage, error) {
	args := map[string]any{}
	if cwd != "" {
		args["cwd"] = cwd
	}
	return c.call(ctx, daemonPermissions, "get_providers_snapshot_request", "get_providers_snapshot_response", args, false)
}

func (c *Client) Create(ctx context.Context, agentID string, spec contract.SessionSpec) (contract.RemoteRef, error) {
	var ref contract.RemoteRef
	if !uuidPattern.MatchString(agentID) || spec.Provider == "" || spec.WorkDir == "" {
		return ref, errors.New("Paseo create requires a caller agent UUID, provider, and working directory")
	}
	ref.AgentID = agentID
	config := map[string]string{"provider": spec.Provider, "cwd": spec.WorkDir}
	for key, value := range map[string]string{"model": spec.Model, "thinkingOptionId": spec.Thinking, "modeId": spec.Mode} {
		if value != "" {
			config[key] = value
		}
	}
	args := map[string]any{"config": config, "agentId": agentID, "idempotencyKey": agentID}
	if len(spec.Labels) != 0 {
		args["labels"] = spec.Labels
	}
	if spec.Prompt != "" {
		ref.TurnID = agentID
		args["initialPrompt"] = spec.Prompt
		args["clientMessageId"] = ref.TurnID
	}
	payload, err := c.call(ctx, writePermissions, "agent.create.request", "agent.create.response", args, true)
	if err != nil {
		return ref, err
	}
	var reply struct {
		Agent *struct{ ID string } `json:"agent"`
		Error *string              `json:"error"`
	}
	if json.Unmarshal(payload, &reply) != nil || reply.Agent == nil || reply.Agent.ID != agentID || reply.Error != nil {
		return ref, unknownReply("creation")
	}
	return ref, nil
}

func (c *Client) Send(ctx context.Context, ref contract.RemoteRef, text string) error {
	if ref.AgentID == "" {
		return errors.New("Paseo send requires an agent ID")
	}
	messageID := ref.TurnID
	if messageID == "" {
		return errors.New("Paseo send requires a persisted message ID")
	}
	payload, err := c.call(ctx, writePermissions, "send_agent_message_request", "send_agent_message_response",
		map[string]any{"agentId": ref.AgentID, "messageId": messageID, "text": text}, true)
	if err != nil {
		return err
	}
	var reply struct {
		AgentID  string  `json:"agentId"`
		Accepted bool    `json:"accepted"`
		Error    *string `json:"error"`
	}
	if json.Unmarshal(payload, &reply) != nil || reply.AgentID != ref.AgentID || !reply.Accepted || reply.Error != nil {
		return unknownReply("message delivery")
	}
	return nil
}

func (c *Client) Cancel(ctx context.Context, ref contract.RemoteRef) error {
	return c.agentAction(ctx, ref, "cancel_agent_request", "cancel_agent_response", nil)
}

func (c *Client) Archive(ctx context.Context, ref contract.RemoteRef) error {
	return c.agentAction(ctx, ref, "archive_agent_request", "agent_archived", nil)
}

func (c *Client) SetModel(ctx context.Context, ref contract.RemoteRef, modelID string) error {
	return c.agentAction(ctx, ref, "set_agent_model_request", "set_agent_model_response", map[string]any{"modelId": modelID})
}

func (c *Client) SetThinking(ctx context.Context, ref contract.RemoteRef, thinkingOptionID string) error {
	return c.agentAction(ctx, ref, "set_agent_thinking_request", "set_agent_thinking_response", map[string]any{"thinkingOptionId": thinkingOptionID})
}

func (c *Client) agentAction(ctx context.Context, ref contract.RemoteRef, request, response string, args map[string]any) error {
	if ref.AgentID == "" {
		return errors.New("Paseo action requires an agent ID")
	}
	if args == nil {
		args = map[string]any{}
	}
	args["agentId"] = ref.AgentID
	payload, err := c.call(ctx, writePermissions, request, response, args, true)
	if err != nil {
		return err
	}
	var reply struct {
		AgentID    string  `json:"agentId"`
		ArchivedAt string  `json:"archivedAt"`
		Accepted   *bool   `json:"accepted"`
		Error      *string `json:"error"`
	}
	if json.Unmarshal(payload, &reply) != nil || reply.AgentID != ref.AgentID ||
		(response == "agent_archived" && reply.ArchivedAt == "") ||
		(args["modelId"] != nil || args["thinkingOptionId"] != nil) && reply.Accepted == nil {
		return unknownReply(request)
	}
	if reply.Error != nil || (reply.Accepted != nil && !*reply.Accepted) {
		return fmt.Errorf("Paseo did not accept %s", request)
	}
	return nil
}

func unknownReply(operation string) error {
	return fmt.Errorf("%w: Paseo did not confirm %s", contract.ErrDeliveryUncertain, operation)
}
