package figuredomain

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

// PartActions splits one generation intent into independently scheduled parts.
// The execution layer owns concurrency, durable intent IDs, retries and model calls.
func PartActions(parent contract.Action) ([]contract.Action, error) {
	if parent.Kind != "request_figure" || parent.Stage != "figure" || parent.FigureID != "" {
		return []contract.Action{parent}, nil
	}
	action, err := batchInput(parent)
	if err != nil {
		return nil, err
	}
	batchIDs := ids(action["figureIds"])
	rows := list(action["parts"])
	if len(rows) != len(batchIDs) {
		return nil, errors.New("figure action is missing generation parts")
	}
	result := make([]contract.Action, len(rows))
	for i, raw := range rows {
		row := obj(raw)
		id := str(row["figureId"])
		if id != batchIDs[i] {
			return nil, errors.New("figure action part does not match its batch slot")
		}
		part := omit(action, "parts", "figureIds")
		for _, key := range []string{"figureId", "progress", "candidates", "style", "motifs", "previous"} {
			copyPresent(part, row, key)
		}
		input, err := json.Marshal(part)
		if err != nil {
			return nil, err
		}
		result[i] = contract.Action{StateVersion: parent.StateVersion, Kind: parent.Kind, Stage: parent.Stage, FigureID: id, Input: input}
	}
	return result, nil
}

// ChildResult records a terminal execution fact for one issued generation part.
// Exactly one of Figure and Failure is required.
type ChildResult struct {
	FigureID string
	Revision int64
	Pass     string
	Figure   json.RawMessage
	Failure  string
}

var ErrNoFiguresPrepared = errors.New("no figures prepared")

// Collect turns a complete batch into one editorial result event. Incomplete
// batches, duplicates, foreign IDs and wrong revisions or passes produce no event.
func Collect(parent contract.Action, eventID string, expectedVersion int64, children []ChildResult) (contract.Event, error) {
	var empty contract.Event
	if eventID == "" || expectedVersion < 1 || (parent.StateVersion > 0 && parent.StateVersion != expectedVersion) {
		return empty, errors.New("figure result requires event identity and state version")
	}
	action, err := batchInput(parent)
	if err != nil {
		return empty, err
	}
	figureIDs := ids(action["figureIds"])
	pass, revision := str(action["pass"]), int64(count(action["revision"]))
	if len(children) != len(figureIDs) {
		return empty, errors.New("figure result lacks a terminal outcome for each part")
	}
	byID := make(map[string]ChildResult, len(children))
	for _, child := range children {
		_, exists := byID[child.FigureID]
		if exists || !slices.Contains(figureIDs, child.FigureID) || child.Revision != revision || child.Pass != pass ||
			(len(child.Figure) == 0) == (child.Failure == "") {
			return empty, errors.New("figure child result does not match the parent action")
		}
		byID[child.FigureID] = child
	}
	figures := []json.RawMessage{}
	failures := []object{}
	for _, id := range figureIDs {
		child := byID[id]
		if child.Failure != "" {
			failures = append(failures, object{"id": id, "error": truncate(child.Failure, 200)})
			continue
		}
		var row object
		if json.Unmarshal(child.Figure, &row) != nil || row["id"] != id {
			return empty, fmt.Errorf("figure output does not match child %s", id)
		}
		figures = append(figures, child.Figure)
	}
	if len(figures) == 0 {
		return empty, ErrNoFiguresPrepared
	}
	body := object{
		"expectedVersion": expectedVersion, "revision": revision, "stage": "figure", "pass": pass,
		"figureIds": figureIDs, "output": object{"figures": figures},
	}
	if len(failures) > 0 {
		body["failed"] = failures
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return empty, err
	}
	return contract.Event{ID: eventID, Actor: "adapter", Kind: "figure_result", Body: raw}, nil
}

func batchInput(parent contract.Action) (object, error) {
	var action object
	if parent.Kind != "request_figure" || parent.Stage != "figure" || parent.FigureID != "" ||
		json.Unmarshal(parent.Input, &action) != nil || action["type"] != "request_figure" ||
		action["stage"] != "figure" || count(action["revision"]) < 1 ||
		(action["pass"] != drawPass && action["pass"] != fixPass) {
		return nil, errors.New("invalid parent figure action")
	}
	figureIDs := ids(action["figureIds"])
	if len(figureIDs) > maxCandidates || !subset(figureIDs, figureIDs) || slices.ContainsFunc(figureIDs, func(id string) bool { return !figureID.MatchString(id) }) {
		return nil, errors.New("invalid figure batch selection")
	}
	return action, nil
}
