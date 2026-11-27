// Package writing implements the editorial transitions without external I/O.
package writing

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"slices"
	"strings"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

type object = map[string]any

var stages = []string{"diagnose", "topic", "audience", "value", "research", "outline", "draft", "review"}

type Rules struct {
	figures FigureRules
}

// FigureRules is the state-local boundary for visual-material transitions.
// Implementations may mutate the copy of state passed to Transition.
type FigureRules interface {
	Action(state map[string]any) (map[string]any, bool)
	Issue(state map[string]any, effectiveStatus string) string
	UserEvent(kind string) bool
	Transition(state, event map[string]any) (bool, error)
}

func New() *Rules { return &Rules{} }

func NewWithFigures(figures FigureRules) *Rules { return &Rules{figures: figures} }

var _ contract.EditorialRules = (*Rules)(nil)

func obj(value any) object {
	result, _ := value.(map[string]any)
	return result
}

func array(value any) []any {
	result, _ := value.([]any)
	return result
}

func str(value any) string {
	result, _ := value.(string)
	return result
}

func text(value any) bool { return strings.TrimSpace(str(value)) != "" }

func intValue(value any) int64 {
	n, ok := value.(float64)
	if !ok || math.Trunc(n) != n || math.Abs(n) > 1<<53-1 {
		return -1
	}
	return int64(n)
}

func num(value int64) float64 { return float64(value) }

func isOneOf(value string, options ...string) bool { return slices.Contains(options, value) }

func fullPlan(value any) bool {
	plan := array(value)
	if len(plan) != len(stages) {
		return false
	}
	for i, stage := range stages {
		if plan[i] != stage {
			return false
		}
	}
	return true
}

func completePlan() []any {
	result := make([]any, len(stages))
	for i, stage := range stages {
		result[i] = stage
	}
	return result
}

func decodeRecord(run contract.Run) (map[string]json.RawMessage, object, error) {
	record := map[string]json.RawMessage{}
	if len(run.Value) == 0 {
		return record, nil, nil
	}
	if err := json.Unmarshal(run.Value, &record); err != nil || record == nil {
		return nil, nil, errors.New("Invalid run record")
	}
	var state object
	if raw, exists := record["state"]; exists && json.Unmarshal(raw, &state) != nil {
		return nil, nil, errors.New("Invalid state envelope")
	}
	return record, state, nil
}

func eventRecord(event contract.Event) (object, string, error) {
	var body []byte
	fields := object{}
	if len(event.Body) != 0 {
		if json.Unmarshal(event.Body, &fields) != nil || fields == nil {
			return nil, "", errors.New("Invalid editorial event")
		}
		buffer := new(bytes.Buffer)
		if json.Compact(buffer, event.Body) != nil {
			return nil, "", errors.New("Invalid editorial event")
		}
		body = buffer.Bytes()
	}
	var prefix []string
	for _, field := range []struct{ key, value string }{
		{"id", event.ID}, {"actor", event.Actor}, {"type", event.Kind},
	} {
		if current, exists := fields[field.key]; exists {
			if field.value != "" && field.value != current {
				return nil, "", errors.New("Editorial event envelope disagrees with body")
			}
			continue
		}
		raw, _ := json.Marshal(field.value)
		prefix = append(prefix, fmt.Sprintf("%q:%s", field.key, raw))
		fields[field.key] = field.value
	}
	if len(body) > 2 {
		prefix = append(prefix, string(body[1:len(body)-1]))
	}
	return fields, "{" + strings.Join(prefix, ",") + "}", nil
}

func (rules *Rules) Next(run contract.Run) (contract.Action, error) {
	record, state, err := decodeRecord(run)
	if err != nil {
		return contract.Action{}, err
	}
	if OnMigrationHold(record["issueKind"]) {
		return contract.Action{}, nil
	}
	body := rules.action(state)
	input, err := json.Marshal(body)
	if err != nil {
		return contract.Action{}, err
	}
	kind := str(body["type"])
	if isOneOf(kind, "wait_for_user", "publication_adapter_required", "requirements_required") {
		kind = ""
	}
	stage := str(body["stage"])
	if kind == "request_route" {
		stage = "route"
	}
	return contract.Action{StateVersion: intValue(state["version"]), Kind: kind, Stage: stage, FigureID: str(body["figureId"]), Input: input}, nil
}

func (rules *Rules) action(state object) object {
	revision := state["revision"]
	if issue := rules.issue(state); issue != "" {
		result := object{"type": "requirements_required", "reason": issue}
		if revision != nil {
			result["revision"] = revision
		}
		return result
	}
	status, stage := str(state["status"]), str(state["stage"])
	switch status {
	case "waiting_ai":
		result := object{"type": "request_ai", "stage": stage, "revision": revision, "feedback": state["feedback"]}
		if stage == "draft" {
			draftAction(state, result)
		}
		return result
	case "waiting_route":
		return object{"type": "request_route", "allowedStages": completePlan(), "feedback": state["feedback"], "revision": revision}
	case "publication_ready":
		return object{"type": "publication_adapter_required", "revision": revision, "executed": false}
	}
	if rules.figures != nil {
		if action, handled := rules.figures.Action(state); handled {
			return action
		}
	}
	return object{"type": "wait_for_user", "status": status, "revision": revision}
}

func (rules *Rules) Reduce(run contract.Run, event contract.Event) (contract.Run, error) {
	record, state, err := decodeRecord(run)
	if err != nil {
		return run, err
	}
	fields, serialized, err := eventRecord(event)
	if err != nil {
		return run, err
	}
	eventID, kind := str(fields["id"]), str(fields["type"])
	if !text(eventID) {
		return run, errors.New("Event id required")
	}
	actor := "adapter"
	if isOneOf(kind, "start", "feedback", "complete_requirements", "satisfy", "authorize_publication", "pause", "resume", "retry", "approve_brief", "revise_brief") ||
		(rules.figures != nil && rules.figures.UserEvent(kind)) {
		actor = "user"
	}
	if fields["actor"] != actor {
		return run, errors.New("Event actor does not match responsibility")
	}
	if state == nil {
		state, err = start(fields, serialized)
		if err != nil {
			return run, err
		}
		if run.RequestID == "" {
			run.RequestID = eventID
		}
		return withState(run, record, state)
	}

	seen := obj(state["seen"])
	if previous, exists := seen[eventID]; exists {
		if previous != serialized {
			return run, errors.New("Event id reused with different content")
		}
		return run, nil
	}
	if !stateEnvelope(state) {
		return run, errors.New("Invalid state envelope")
	}
	if intValue(fields["expectedVersion"]) != intValue(state["version"]) {
		return run, errors.New("Stale state version")
	}
	issue := rules.issue(state)
	if issue != "" && !isOneOf(kind, "complete_requirements", "pause", "fail") {
		return run, fmt.Errorf("Requirements contract incomplete: %s", issue)
	}
	ensureLog(state)
	before := state["status"]
	if err := rules.apply(state, fields, issue); err != nil {
		return run, err
	}
	if issue := rules.issue(state); issue != "" && !isOneOf(kind, "pause", "fail") {
		return run, fmt.Errorf("Requirements contract incomplete: %s", issue)
	}
	state["version"] = num(intValue(state["version"]) + 1)
	seen[eventID] = serialized
	state["lastTransition"] = object{"event": kind, "from": before, "to": state["status"]}
	return withState(run, record, state)
}

func withState(run contract.Run, record map[string]json.RawMessage, state object) (contract.Run, error) {
	rawState, err := json.Marshal(state)
	if err != nil {
		return run, err
	}
	record["state"] = rawState
	raw, err := json.Marshal(record)
	if err != nil {
		return run, err
	}
	run.Value = raw
	run.Version = max(run.Version+1, intValue(state["version"]))
	if run.ID == "" {
		run.ID = str(state["articleId"])
	}
	return run, nil
}

func start(event object, serialized string) (object, error) {
	if event["type"] != "start" {
		return nil, errors.New("First event must be start")
	}
	if !text(event["articleId"]) || (!text(event["source"]) && !text(event["idea"])) {
		return nil, errors.New("Article id and source or idea required")
	}
	if plan, exists := event["plan"]; exists && !fullPlan(plan) {
		return nil, errors.New("Invalid editorial plan: full STAGES required")
	}
	for _, field := range []string{"source", "idea"} {
		if value, exists := event[field]; exists {
			if _, valid := value.(string); !valid {
				return nil, errors.New("Source and idea must be text")
			}
		}
	}
	direction, err := normalizeDirection(event)
	if err != nil {
		return nil, err
	}
	state := object{
		"plan": completePlan(), "schemaVersion": num(1), "articleId": event["articleId"], "version": num(1),
		"revision": num(1), "status": "waiting_ai", "stage": "diagnose", "source": str(event["source"]),
		"idea": str(event["idea"]), "direction": direction, "artifacts": object{}, "history": []any{},
		"seen": object{str(event["id"]): serialized}, "approval": nil, "satisfiedRevision": nil, "requirementLog": []any{},
	}
	recordChanges(state, "form", formChanges(direction))
	return state, nil
}

func ai(state object, stage string) {
	state["stage"] = stage
	state["status"] = "waiting_ai"
	delete(state, "draftParts")
	delete(state, "retry")
}
