package writingai

import (
	_ "embed"
	"encoding/json"
	"slices"
	"strconv"
	"strings"
)

//go:embed templates/prompts.json
var promptJSON []byte

type specification struct {
	Task        string
	Steps       []string
	Rules       []string
	Criteria    []string
	Example     json.RawMessage
	OutputNotes []string
}

var templates = func() (data struct {
	Basic      map[string]specification
	Fragments  map[string]string
	Team       string
	Roles      map[string]string
	Guard      map[string]string
	StoryRules map[string][]string
	ModeRules  map[string]map[string][]string
	LevelRules map[string][]string
	Checks     []struct {
		ID    string
		Ask   string
		Story bool
	}
	Modes      []string
	Levels     []string
	StageRoles map[string]string
}) {
	if err := json.Unmarshal(promptJSON, &data); err != nil {
		panic("invalid embedded writing prompt contract")
	}
	return
}()

func frame(stage string, spec specification, data ordered, reused bool, omitted []string) string {
	lines := []string{"[과업 ID: " + stage + "]"}
	if !reused {
		lines = append(lines, "## 역할", templates.Team, templates.Roles[templates.StageRoles[stage]])
	}
	lines = append(lines, "## 이번 일", spec.Task)
	if len(spec.Steps) > 0 {
		lines = append(lines, "## 순서")
		for i, step := range spec.Steps {
			lines = append(lines, strconv.Itoa(i+1)+". "+step)
		}
	}
	addBullets := func(title string, items []string) {
		if len(items) > 0 {
			lines = append(lines, "## "+title)
			for _, item := range items {
				lines = append(lines, "- "+item)
			}
		}
	}
	addBullets("규칙", spec.Rules)
	lines = append(lines, "## 통과 기준", "반환하기 전에 각 항목을 하나씩 확인한다. 하나라도 '아니오'이면 고친 뒤 반환한다.")
	for _, criterion := range spec.Criteria {
		lines = append(lines, "- "+criterion)
	}
	lines = append(lines, "## 출력")
	if !reused {
		lines = append(lines, templates.Guard["output"])
	}
	lines = append(lines, string(encode(spec.Example)))
	for _, note := range spec.OutputNotes {
		lines = append(lines, "- "+note)
	}
	if reused {
		keys := strings.Join(omitted, ", ")
		if keys == "" {
			keys = "없음"
		}
		addBullets("지킬 것", []string{
			"같은 대화의 이전 과업은 종료되었다. 이번 메시지의 지시와 출력 형식만 따른다. 첫 과업의 '역할', '지킬 것', 출력 규칙 및 이전에 전달받은 자료(키: " + keys + ")는 그대로 유효하며, 아래 <자료>에는 새로 생성되었거나 변경된 항목만 포함되어 있다.",
			templates.Guard["trust"],
		})
	} else {
		addBullets("지킬 것", []string{templates.Guard["trust"], templates.Guard["noTools"], templates.Guard["noFabrication"]})
	}
	lines = append(lines, "<자료>", strings.ReplaceAll(string(data.raw()), "</", `<\/`), "</자료>",
		"위 자료를 바탕으로 '이번 일'을 마치고 '통과 기준'을 모두 확인한 뒤, '출력' 형식에 맞는 JSON 객체 하나만 반환한다.")
	return strings.Join(lines, "\n")
}

func promptSpec(stage string, state map[string]json.RawMessage, input actionInput, requirements ordered) specification {
	key := stage
	if stage == "draft" && input.Mode == "edit" {
		key = "edit"
	}
	spec := templates.Basic[key]
	spec.Steps, spec.Criteria = slices.Clone(spec.Steps), slices.Clone(spec.Criteria)
	switch stage {
	case "diagnose":
		if mode := requirement(requirements, "mode"); mode != "" {
			spec.Steps[1] = fragment("mode", "mode", mode)
		}
		if level := requirement(requirements, "readerLevel"); level != "" {
			spec.Steps[2] = fragment("level", "level", level)
		}
	case "outline":
		if stringOf(fields(state["retry"])["stage"]) == "outline" {
			spec.Steps = append(spec.Steps, fragment("outlineRetry"))
		}
	case "draft", "review":
		modes, level := direction(state, requirements)
		story := slices.ContainsFunc(modes, func(mode string) bool { return mode != "procedure" })
		spec.Rules = slices.Clone(spec.Rules)
		if story {
			spec.Rules = append(spec.Rules, templates.StoryRules[stage]...)
		}
		for _, mode := range modes {
			spec.Rules = append(spec.Rules, templates.ModeRules[mode][stage]...)
		}
		spec.Rules = append(spec.Rules, templates.LevelRules[level]...)
		if stage == "review" {
			spec.Steps[1] = fragment("checks")
			var ids []string
			for _, check := range templates.Checks {
				if !check.Story || story {
					ids = append(ids, check.ID)
					spec.Steps[1] += "\n   - " + check.ID + ": " + check.Ask
				}
			}
			spec.Criteria[0] = fragment("criteria", "checks", strings.Join(ids, "·"))
		} else if key == "edit" {
			if input.RetryNote != "" {
				spec.Criteria = append(spec.Criteria, fragment("retry", "note", input.RetryNote))
			}
		} else {
			spec = draftSpec(spec, input, truthy(state["feedback"]))
		}
	}
	return spec
}

func draftSpec(spec specification, input actionInput, editing bool) specification {
	section := input.Section
	rejected, retry := input.Rejected, input.RetryNote
	if section != nil {
		rejected, retry = section.Rejected, section.RetryNote
	}
	build := make([]string, 0, len(spec.Steps)+1)
	if rejected != "" {
		build = append(build, fragment("rejected"))
	} else if editing {
		build = append(build, fragment("editing"))
	}
	if section == nil {
		spec.Steps = append(build, spec.Steps...)
	} else {
		spec.Task = fragment("sectionTask", "number", strconv.Itoa(section.Index+1), "total", strconv.Itoa(section.Total), "title", section.Title)
		part := "sectionLater"
		if section.Index == 0 {
			part = "sectionFirst"
			build = append(build, spec.Steps[0])
		}
		build = append(build, fragment(part, "title", section.Title), spec.Steps[2])
		if section.Index == section.Total-1 {
			build = append(build, spec.Steps[3])
		}
		spec.Steps = build
		spec.OutputNotes = []string{fragment("sectionNotes")}
		if section.Budget != 0 {
			part := "budget"
			if section.Floor != 0 {
				part = "budgetFloor"
			}
			spec.Criteria[0] = fragment(part, "budget", strconv.Itoa(section.Budget), "limit", strconv.Itoa(section.Limit), "floor", strconv.Itoa(section.Floor))
		}
	}
	if retry != "" {
		spec.Criteria = slices.Insert(spec.Criteria, 1, fragment("retry", "note", retry))
	}
	return spec
}

func fragment(key string, args ...string) string {
	for i := 0; i < len(args); i += 2 {
		args[i] = "{{" + args[i] + "}}"
	}
	return strings.NewReplacer(args...).Replace(templates.Fragments[key])
}
