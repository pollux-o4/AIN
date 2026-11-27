// Package figureai translates figure actions into Paseo turns and validated results.
package figureai

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"slices"
	"strings"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/figuredomain"
	"github.com/pollux-o4/AIN/backend/internal/promptframe"
)

type Model struct {
	Provider string
	Model    string
	Thinking string
	Mode     string
}

// LabPolicy varies only the analogy planning, checking and drawing instructions.
type LabPolicy struct {
	Plan  string `json:"plan"`
	Check string `json:"check"`
	Draw  string `json:"draw"`
}

type Config struct {
	LabPolicy   *LabPolicy
	WorkRoot    string
	Default     Model
	StageModels map[string]Model
	// LayoutCheck is the absolute path of the optional, one-shot layout tool.
	// The Go service does not run or wait on a Node process.
	LayoutCheck string
	KitIndex    string
}

type Builder struct{ config Config }

func New(config Config) (*Builder, error) {
	if !filepath.IsAbs(config.WorkRoot) {
		return nil, errors.New("figure work root must be absolute")
	}
	for _, path := range []string{config.LayoutCheck, config.KitIndex} {
		if path != "" && !filepath.IsAbs(path) {
			return nil, errors.New("figure tool path must be absolute")
		}
	}
	if config.LabPolicy != nil {
		policy := *config.LabPolicy
		for _, instruction := range []string{policy.Plan, policy.Check, policy.Draw} {
			if strings.TrimSpace(instruction) == "" || len(instruction) > 8192 {
				return nil, errors.New("invalid figure lab policy")
			}
		}
		config.LabPolicy = &policy
	}
	config.WorkRoot = filepath.Clean(config.WorkRoot)
	models := make(map[string]Model, len(config.StageModels))
	for stage, model := range config.StageModels {
		if !slices.Contains([]string{"figure_plan", "figure_compose", "figure"}, stage) {
			return nil, errors.New("invalid figure model stage")
		}
		models[stage] = model
	}
	config.StageModels = models
	return &Builder{config: config}, nil
}

var _ contract.TurnBuilder = (*Builder)(nil)

type object = map[string]any

type actionInput struct {
	Type       string   `json:"type"`
	Stage      string   `json:"stage"`
	Revision   int64    `json:"revision"`
	FigureID   string   `json:"figureId"`
	Pass       string   `json:"pass"`
	Candidates []object `json:"candidates"`
	Previous   []object `json:"previous"`
	Recompose  []string `json:"recompose"`
	Units      []string `json:"units"`
	Style      struct {
		Look string `json:"look"`
	} `json:"style"`
}

func parseAction(action contract.Action) (actionInput, map[string]json.RawMessage, error) {
	var input actionInput
	var fields map[string]json.RawMessage
	invalid := errors.New("invalid figure action")
	if action.Kind != "request_figure" || action.StateVersion < 1 ||
		json.Unmarshal(action.Input, &input) != nil || json.Unmarshal(action.Input, &fields) != nil ||
		input.Type != action.Kind || input.Stage != action.Stage || input.Revision < 1 {
		return input, nil, invalid
	}
	switch input.Stage {
	case "figure_plan":
		if action.FigureID != "" || len(input.Units) == 0 {
			return input, nil, invalid
		}
	case "figure_compose":
		if action.FigureID != "" || len(input.Candidates) == 0 {
			return input, nil, invalid
		}
	case "figure":
		if !figureID.MatchString(action.FigureID) || action.FigureID != input.FigureID ||
			len(input.Candidates) != 1 || text(input.Candidates[0]["id"]) != action.FigureID ||
			(input.Pass != "draw" && input.Pass != "fix") {
			return input, nil, invalid
		}
		if input.Pass == "fix" && (len(input.Previous) != 1 || text(input.Previous[0]["id"]) != action.FigureID) ||
			input.Pass == "draw" && len(input.Previous) > 0 {
			return input, nil, invalid
		}
	default:
		return input, nil, invalid
	}
	return input, fields, nil
}

func text(value any) string { s, _ := value.(string); return s }

func (builder *Builder) BuildTurn(run contract.Run, action contract.Action) (contract.SessionSpec, error) {
	var spec contract.SessionSpec
	input, fields, err := parseAction(action)
	if err != nil {
		return spec, err
	}
	var record struct {
		State struct {
			Idea      string `json:"idea"`
			Revision  int64  `json:"revision"`
			Version   int64  `json:"version"`
			Artifacts map[string]struct {
				Output json.RawMessage `json:"output"`
			} `json:"artifacts"`
		} `json:"state"`
	}
	if json.Unmarshal(run.Value, &record) != nil || record.State.Revision != input.Revision ||
		record.State.Version != action.StateVersion {
		return spec, errors.New("stale figure action")
	}
	var draft struct {
		Text string `json:"text"`
	}
	if json.Unmarshal(record.State.Artifacts["draft"].Output, &draft) != nil || strings.TrimSpace(draft.Text) == "" {
		return spec, errors.New("figure action requires a finished draft")
	}
	// Node figureContext와 같은 키 순서 · 비어 있는 값은 싣지 않는다
	var artifacts fieldList
	for _, stage := range []string{"audience", "value", "outline"} {
		artifacts.add(stage, record.State.Artifacts[stage].Output)
	}
	artifacts.add("draft", promptframe.Encode(object{"text": draft.Text}))
	var contextData fieldList
	contextData.add("idea", promptframe.Encode(record.State.Idea))
	contextData.add("artifacts", artifacts.raw())
	contextData.add("placementNote", fields["note"])
	for _, key := range []string{"units", "candidates", "style", "look", "motifs", "world", "recompose", "feedback", "progress", "pass"} {
		contextData.add(key, fields[key])
	}
	model := builder.config.Default
	if override, exists := builder.config.StageModels[input.Stage]; exists {
		model = override
	}
	if strings.TrimSpace(model.Provider) == "" || strings.TrimSpace(model.Model) == "" {
		return spec, errors.New("figure model has not been configured")
	}
	if input.Stage == "figure" {
		if route := EffectiveRoute(text(input.Candidates[0]["kind"]), text(input.Candidates[0]["route"])); route != "svg" {
			return spec, ErrRouteUnavailable
		}
	}
	workDir := builder.config.WorkRoot
	if action.WorkID != "" || input.Stage == "figure" {
		room, err := openWorkspace(builder.config.WorkRoot, action.WorkID, true)
		if err != nil {
			return spec, err
		}
		defer room.close()
		workDir = room.dir
		if input.Pass == "fix" {
			previous, err := writeBaseline(room, action.FigureID, input.Previous[0])
			if err != nil {
				return spec, err
			}
			contextData.add("previous", promptframe.Encode([]object{previous}))
		}
	}
	prompt := builder.prompt(input, contextData.raw())
	return contract.SessionSpec{
		Provider: model.Provider, Model: model.Model, Thinking: model.Thinking, Mode: model.Mode,
		WorkDir: workDir, Prompt: prompt,
		Labels: map[string]string{"ain.stage": input.Stage},
	}, nil
}

func writeBaseline(room *workspace, id string, old object) (object, error) {
	svg, err := figuredomain.NormalizeSVG(text(old["svg"]))
	if err != nil {
		return nil, err
	}
	svgFile, err := room.putInput("input-"+id+".svg", svg)
	if err != nil {
		return nil, err
	}
	data := object{"id": id, "svgFile": svgFile}
	for _, key := range []string{"anchor", "claim", "alt", "caption", "notes"} {
		if value := text(old[key]); value != "" {
			data[key] = value
		}
	}
	if source := text(old["source"]); source != "" {
		if utf16Length(source) > sourceLimit {
			return nil, errors.New("figure baseline source exceeds its text contract")
		}
		sourceFile, err := room.putInput("input-"+id+".source.mjs", source)
		if err != nil {
			return nil, err
		}
		data["sourceFile"] = sourceFile
	}
	return data, nil
}
