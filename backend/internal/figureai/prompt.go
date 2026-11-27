package figureai

import (
	_ "embed"
	"encoding/json"
	"strings"

	"github.com/pollux-o4/AIN/backend/internal/promptframe"
)

// 지시문은 Node 기준(automation/paseo/prompts/figure.mjs·looks.mjs)에서 templates/generate.mjs로 추출한다.
// Go는 자리표(대상 정책·도구 경로)만 채워 공통 틀에 싣는다 · ADR-0013
//
//go:embed templates/prompts.json
var promptJSON []byte

type specification struct {
	Task        string
	Steps       []string
	Rules       []string
	Criteria    []string
	Example     json.RawMessage
	OutputNotes []string
	Guards      []string
}

var templates = func() (data struct {
	Plan        specification
	Compose     specification
	Figure      map[string]specification
	DefaultLook string
	Baseline    LabPolicy
}) {
	if err := json.Unmarshal(promptJSON, &data); err != nil || data.Figure["draw:"+data.DefaultLook].Task == "" {
		panic("invalid embedded figure prompt contract")
	}
	return
}()

func (builder *Builder) specFor(input actionInput) specification {
	switch input.Stage {
	case "figure_plan":
		return templates.Plan
	case "figure_compose":
		return templates.Compose
	}
	pass := input.Pass
	if pass == "" {
		pass = "draw"
	}
	spec, known := templates.Figure[pass+":"+input.Style.Look]
	if !known {
		spec = templates.Figure[pass+":"+templates.DefaultLook]
	}
	return spec
}

func (builder *Builder) prompt(input actionInput, data []byte) string {
	policy := templates.Baseline
	if builder.config.LabPolicy != nil {
		policy = *builder.config.LabPolicy
	}
	fill := strings.NewReplacer(
		"{{policy.plan}}", policy.Plan, "{{policy.check}}", policy.Check, "{{policy.draw}}", policy.Draw,
		"{{layoutCheck}}", builder.config.LayoutCheck, "{{kitIndex}}", builder.config.KitIndex,
	).Replace
	each := func(lines []string) []string {
		out := make([]string, len(lines))
		for i, line := range lines {
			out[i] = fill(line)
		}
		return out
	}
	spec := builder.specFor(input)
	return promptframe.Render(input.Stage, promptframe.Spec{
		Task: fill(spec.Task), Steps: each(spec.Steps), Rules: each(spec.Rules), Criteria: each(spec.Criteria),
		Example: promptframe.Encode(spec.Example), OutputNotes: each(spec.OutputNotes), Guards: each(spec.Guards),
	}, data, nil)
}
