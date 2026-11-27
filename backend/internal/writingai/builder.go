// Package writingai assembles and validates native writing turns without I/O.
package writingai

import (
	"bytes"
	"encoding/json"
	"errors"
	"maps"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

type Config struct {
	Base contract.SessionSpec
	High contract.SessionSpec
}

type Builder struct {
	cfg Config
}

var _ contract.TurnBuilder = (*Builder)(nil)

// New configures the default writing model and its optional rework model.
func New(cfg Config) *Builder {
	cfg.Base.Labels = maps.Clone(cfg.Base.Labels)
	cfg.High.Labels = maps.Clone(cfg.High.Labels)
	return &Builder{cfg: cfg}
}

func Role(action contract.Action) string {
	stage, err := taskID(action)
	if err != nil {
		return ""
	}
	return templates.StageRoles[stage]
}

func (b *Builder) BuildTurn(run contract.Run, action contract.Action) (contract.SessionSpec, error) {
	spec, _, err := b.build(run, action, nil)
	return spec, err
}

// BuildReuseTurn sends just the changed data to an existing session of the same
// role. Persist the returned fingerprints only after successful delivery.
func (b *Builder) BuildReuseTurn(run contract.Run, action contract.Action, delivered map[string]string) (contract.SessionSpec, map[string]string, error) {
	if delivered == nil {
		delivered = map[string]string{}
	}
	return b.build(run, action, delivered)
}

func (b *Builder) build(run contract.Run, action contract.Action, delivered map[string]string) (contract.SessionSpec, map[string]string, error) {
	stage, err := taskID(action)
	if err != nil {
		return contract.SessionSpec{}, nil, err
	}
	state := fields(fields(run.Value)["state"])
	if state == nil {
		return contract.SessionSpec{}, nil, errors.New("invalid writing state")
	}
	input, err := decodeAction(action)
	if err != nil {
		return contract.SessionSpec{}, nil, err
	}
	requirements := standing(state)
	data, artifacts := contextOf(state, stage, input, requirements)
	next := fingerprints(data, artifacts, delivered)
	var omitted []string
	if delivered != nil {
		data, omitted = delta(data, artifacts, delivered, next)
	}
	spec := b.session(state, stage)
	if spec.Provider == "" || spec.Model == "" || spec.WorkDir == "" {
		return contract.SessionSpec{}, nil, errors.New("writing model and working directory are required")
	}
	spec.Prompt = frame(stage, promptSpec(stage, state, input, requirements), data, delivered != nil, omitted)
	return spec, next, nil
}

func (b *Builder) session(state map[string]json.RawMessage, stage string) contract.SessionSpec {
	spec := b.cfg.Base
	if b.cfg.High.Provider != "" && (stage == "review" || stringOf(state["stage"]) == "review" || present(state["retry"]) || truthy(state["feedback"])) {
		high := b.cfg.High
		spec.Provider, spec.Model, spec.Thinking = high.Provider, high.Model, high.Thinking
		if high.Mode != "" {
			spec.Mode = high.Mode
		}
		if high.WorkDir != "" {
			spec.WorkDir = high.WorkDir
		}
		spec.Labels = maps.Clone(spec.Labels)
		if spec.Labels == nil {
			spec.Labels = map[string]string{}
		}
		maps.Copy(spec.Labels, high.Labels)
	}
	spec.Labels = maps.Clone(spec.Labels)
	return spec
}

type sectionInput struct {
	Index     int
	Total     int
	Title     string
	Budget    int
	Limit     int
	Floor     int
	Rejected  string
	RetryNote string
}

type actionInput struct {
	Revision  int64
	Mode      string
	Rejected  string
	RetryNote string
	Section   *sectionInput
}

func decodeAction(action contract.Action) (actionInput, error) {
	var input actionInput
	if len(action.Input) == 0 || json.Unmarshal(action.Input, &input) != nil {
		return input, errors.New("invalid writing action")
	}
	if section := input.Section; section != nil &&
		(section.Index < 0 || section.Index >= section.Total || section.Title == "") {
		return input, errors.New("invalid writing section")
	}
	return input, nil
}

func taskID(action contract.Action) (string, error) {
	if action.Kind == "request_route" {
		return "route", nil
	}
	if action.Kind == "request_ai" && templates.StageRoles[action.Stage] != "" && action.Stage != "route" {
		return action.Stage, nil
	}
	return "", errors.New("unsupported writing action")
}

func fields(raw json.RawMessage) map[string]json.RawMessage {
	var result map[string]json.RawMessage
	_ = json.Unmarshal(raw, &result)
	return result
}

func values(raw json.RawMessage) []json.RawMessage {
	var result []json.RawMessage
	_ = json.Unmarshal(raw, &result)
	return result
}

func stringOf(raw json.RawMessage) string {
	var result string
	_ = json.Unmarshal(raw, &result)
	return result
}

func present(raw json.RawMessage) bool {
	return len(raw) != 0 && !bytes.Equal(raw, []byte("null"))
}

func truthy(raw json.RawMessage) bool {
	return present(raw) && !bytes.Equal(raw, []byte(`""`)) && !bytes.Equal(raw, []byte("false")) && !bytes.Equal(raw, []byte("0"))
}

func encode(value any) json.RawMessage {
	var out bytes.Buffer
	enc := json.NewEncoder(&out)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(value); err != nil {
		panic(err) // Callers provide JSON values or fixed Go scalar types.
	}
	return nativeJSON(bytes.TrimSuffix(out.Bytes(), []byte("\n")))
}

// encoding/json quotes HTML characters and line separators in existing raw
// state. JS leaves these characters and a forward slash literal.
func nativeJSON(raw []byte) []byte {
	first := bytes.IndexByte(raw, '\\')
	if first < 0 {
		return raw
	}
	result := append([]byte{}, raw[:first]...)
	for i := first; i < len(raw); i++ {
		if raw[i] != '\\' || i+1 == len(raw) {
			result = append(result, raw[i])
			continue
		}
		if raw[i+1] == '/' {
			result = append(result, '/')
			i++
			continue
		}
		if i+6 <= len(raw) && raw[i+1] == 'u' {
			var replacement string
			switch string(raw[i+2 : i+6]) {
			case "003c", "003C":
				replacement = "<"
			case "003e", "003E":
				replacement = ">"
			case "0026":
				replacement = "&"
			case "2028":
				replacement = "\u2028"
			case "2029":
				replacement = "\u2029"
			}
			if replacement != "" {
				result = append(result, replacement...)
				i += 5
				continue
			}
		}
		result = append(result, raw[i:i+2]...)
		i++
	}
	return result
}
