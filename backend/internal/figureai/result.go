package figureai

import (
	"encoding/json"
	"errors"
	"slices"
	"strings"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/figuredomain"
)

const maxResultJSON = 2500000

var ErrResultPending = errors.New("figure result JSON has not arrived")

func (builder *Builder) ValidateResult(action contract.Action, snapshot contract.Snapshot) (contract.Event, error) {
	var empty contract.Event
	input, _, err := parseAction(action)
	if err != nil {
		return empty, err
	}
	var observed struct {
		DaemonTurnID string `json:"daemonTurnId"`
		Text         string `json:"text"`
	}
	if snapshot.Status != "completed" || len(snapshot.Body) > maxResultJSON ||
		json.Unmarshal(snapshot.Body, &observed) != nil || strings.TrimSpace(observed.DaemonTurnID) == "" {
		return empty, errors.New("figure response does not identify a confirmed terminal turn")
	}
	output, err := parseResult(observed.Text)
	if err != nil {
		return empty, err
	}
	body := object{"expectedVersion": action.StateVersion, "revision": input.Revision, "stage": input.Stage}
	switch input.Stage {
	case "figure_plan":
		if err := validateCandidates(output); err != nil {
			return empty, err
		}
	case "figure_compose":
		if err := validateDesigns(input, output); err != nil {
			return empty, err
		}
	case "figure":
		route := EffectiveRoute(text(input.Candidates[0]["kind"]), text(input.Candidates[0]["route"]))
		if route != "svg" {
			return empty, ErrRouteUnavailable
		}
		if !durableID.MatchString(action.WorkID) {
			return empty, errors.New("figure result requires a durable workspace identity")
		}
		row, err := builder.generation(action, output)
		if err != nil {
			return empty, err
		}
		output = object{"figures": []object{row}}
		body["figureId"], body["pass"] = action.FigureID, input.Pass
	}
	body["output"] = output
	encoded, err := json.Marshal(body)
	if err != nil {
		return empty, err
	}
	return contract.Event{Actor: "adapter", Kind: "figure_result", Body: encoded}, nil
}

func parseResult(message string) (object, error) {
	message = strings.TrimSpace(message)
	if len(message) > maxResultJSON {
		return nil, errors.New("figure response exceeds its size limit")
	}
	if message == "" {
		return nil, ErrResultPending
	}
	jsonText := message
	if strings.HasSuffix(message, "```") {
		before := strings.TrimSuffix(message, "```")
		start := strings.LastIndex(before, "\n```")
		if start >= 0 {
			jsonText = before[start+1:]
		} else {
			jsonText = before
		}
		head, rest, found := strings.Cut(jsonText, "\n")
		if found && (head == "```json" || head == "```") {
			jsonText = strings.TrimSpace(rest)
		}
	}
	var output object
	if json.Unmarshal([]byte(jsonText), &output) == nil && output != nil {
		return output, nil
	}
	// The renderer sometimes prefixes progress notes or image previews.
	if start := strings.LastIndex(message, "\n{"); start >= 0 {
		if json.Unmarshal([]byte(message[start+1:]), &output) == nil && output != nil {
			return output, nil
		}
	}
	if strings.Contains(jsonText, "{") || strings.HasSuffix(message, "```") {
		return nil, errors.New("invalid figure response JSON")
	}
	return nil, ErrResultPending
}

func rows(value any) []any {
	list, _ := value.([]any)
	return list
}

func entry(value any) object {
	m, _ := value.(map[string]any)
	return m
}

func bounded(value any, max int) bool {
	s := text(value)
	return strings.TrimSpace(s) != "" && utf16Length(s) <= max
}

func validateCandidates(output object) error {
	candidates := rows(output["candidates"])
	if len(candidates) == 0 {
		return errors.New("figure response has no placement candidates")
	}
	for _, item := range candidates {
		candidate := entry(item)
		if !bounded(candidate["anchor"], 400) || !bounded(candidate["claim"], 300) || !bounded(candidate["reason"], 500) {
			return errors.New("invalid figure placement candidate")
		}
	}
	return nil
}

func validateDesigns(input actionInput, output object) error {
	targets := input.Recompose
	if len(targets) == 0 {
		for _, candidate := range input.Candidates {
			targets = append(targets, text(candidate["id"]))
		}
	}
	designs := rows(output["designs"])
	if len(designs) != len(targets) {
		return errors.New("figure response must contain one design per requested candidate")
	}
	seen := map[string]bool{}
	for _, item := range designs {
		design := entry(item)
		id := text(design["id"])
		if !figureID.MatchString(id) || !slices.Contains(targets, id) || seen[id] || !bounded(design["scene"], 500) {
			return errors.New("figure design does not match the requested set")
		}
		seen[id] = true
	}
	return nil
}

func (builder *Builder) generation(action contract.Action, output object) (object, error) {
	figures := rows(output["figures"])
	if len(figures) != 1 {
		return nil, errors.New("figure response must contain one rendered figure")
	}
	figure := entry(figures[0])
	id := action.FigureID
	if text(figure["id"]) != id || !bounded(figure["alt"], 300) {
		return nil, errors.New("rendered figure does not match its task")
	}
	svg := text(figure["svg"])
	source := text(figure["source"])
	if figure["svgFile"] != nil || figure["sourceFile"] != nil {
		work, err := openWorkspace(builder.config.WorkRoot, action.WorkID, false)
		if err != nil {
			return nil, err
		}
		defer work.close()
		svg, err = work.read(text(figure["svgFile"]), id+".svg", svgLimit)
		if err != nil {
			return nil, err
		}
		if figure["sourceFile"] != nil {
			source, err = work.read(text(figure["sourceFile"]), id+".source.mjs", sourceLimit)
			if err != nil {
				return nil, err
			}
		}
	}
	svg, err := figuredomain.NormalizeSVG(svg)
	if err != nil {
		return nil, err
	}
	item := object{"id": id, "svg": svg, "alt": strings.TrimSpace(text(figure["alt"]))}
	if bounded(figure["caption"], 200) {
		item["caption"] = strings.TrimSpace(text(figure["caption"]))
	}
	if source != "" && utf16Length(source) <= sourceLimit {
		item["source"] = source
	}
	if notes := text(figure["notes"]); notes != "" {
		item["notes"] = truncate(notes, 600)
	}
	return item, nil
}

func truncate(value string, limit int) string {
	length := 0
	for at, r := range value {
		length++
		if r >= 0x10000 {
			length++
		}
		if length > limit {
			return value[:at]
		}
	}
	return value
}
