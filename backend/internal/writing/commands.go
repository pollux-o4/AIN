package writing

import (
	"encoding/json"
	"errors"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

const agentFeedbackLimit = 2

var (
	ErrHumanApproval      = errors.New("command requires a human")
	ErrAgentFeedbackLimit = errors.New("agent feedback requires a human check-in")
)

type commandPolicy struct {
	agent bool
	round bool
}

var commands = map[string]commandPolicy{
	"feedback":              {agent: true, round: true},
	"revise_brief":          {agent: true, round: true},
	"approve_brief":         {agent: true},
	"pause":                 {agent: true},
	"resume":                {agent: true},
	"complete_requirements": {agent: true},
	"request_figures":       {agent: true},
	"place_figure":          {agent: true},
	"remove_figure":         {agent: true},
	"select_figures":        {agent: true},
	"approve_design":        {agent: true},
	"revise_design":         {agent: true, round: true},
	"revise_figures":        {agent: true, round: true},
	"retry_figures":         {agent: true},
	"confirm_figures":       {},
	"discard_figures":       {},
	"satisfy":               {},
	"authorize_publication": {},
}

// CheckCommand applies the authority and consecutive feedback budget for a
// trusted caller identity. The service records the caller in events and applies
// the command under the same optimistic write to enforce the budget.
// A delegated agent command (the user asked for it in conversation) keeps the
// human-only authority check but neither counts toward nor resets the budget · ADR-0006
func CheckCommand(run contract.Run, kind, actor string, delegated bool) error {
	var identity struct{ IssueKind json.RawMessage }
	if err := json.Unmarshal(run.Value, &identity); err == nil && OnMigrationHold(identity.IssueKind) {
		return contract.ErrDeliveryUncertain
	}
	policy, supported := commands[kind]
	if !supported {
		return errors.New("unsupported editorial command")
	}
	switch actor {
	case "user":
		return nil
	case "agent":
		if !policy.agent {
			return ErrHumanApproval
		}
	default:
		return errors.New("unknown editorial command actor")
	}
	if !policy.round || delegated {
		return nil
	}
	var record struct {
		Events []struct {
			Kind      string `json:"kind"`
			By        string `json:"by"`
			Delegated bool   `json:"delegated"`
		} `json:"events"`
	}
	if json.Unmarshal(run.Value, &record) != nil {
		return errors.New("invalid editorial command history")
	}
	rounds := 0
	for i := len(record.Events) - 1; i >= 0; i-- {
		event := record.Events[i]
		if event.By == "agent" {
			if commands[event.Kind].round && !event.Delegated {
				rounds++
			}
		} else if isOneOf(event.Kind, "feedback", "complete_requirements", "satisfy", "authorize_publication", "approve_brief", "requested") {
			break
		}
	}
	if rounds >= agentFeedbackLimit {
		return ErrAgentFeedbackLimit
	}
	return nil
}

// OnMigrationHold prevents dispatch until the saved legacy job is reconciled.
func OnMigrationHold(issueKind json.RawMessage) bool {
	var kind string
	return json.Unmarshal(issueKind, &kind) == nil && kind == "legacy_reconcile"
}
