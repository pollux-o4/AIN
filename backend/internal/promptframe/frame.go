// Package promptframe renders the task frame every model prompt shares:
// role → task → steps → rules → criteria → output → guards → data (ADR-0013).
// The wording is captured from the Node reference by generate.mjs; Go only assembles it.
package promptframe

import (
	_ "embed"
	"encoding/json"
	"strconv"
	"strings"
)

//go:embed frame.json
var frameJSON []byte

var shared = func() (data struct {
	Team       string
	Roles      map[string]string
	Guard      map[string]string
	StageRoles map[string]string
}) {
	if err := json.Unmarshal(frameJSON, &data); err != nil || data.Team == "" || len(data.Guard) == 0 {
		panic("invalid embedded prompt frame")
	}
	return
}()

// Spec is one task's instructions. Guards replaces the default no-tools guard when set.
type Spec struct {
	Task        string
	Steps       []string
	Rules       []string
	Criteria    []string
	Example     json.RawMessage
	OutputNotes []string
	Guards      []string
}

// Guard returns a shared guard sentence by its Node name (trust, noTools, noFabrication, output).
func Guard(name string) string { return shared.Guard[name] }

// Render assembles the prompt. data must already be the JSON object for the <자료> block.
// omitted is non-nil when the same session already received the first turn's frame.
func Render(id string, spec Spec, data []byte, omitted []string) string {
	reused := omitted != nil
	lines := []string{"[과업 ID: " + id + "]"}
	if !reused {
		lines = append(lines, "## 역할", shared.Team, shared.Roles[shared.StageRoles[id]])
	}
	lines = append(lines, "## 이번 일", spec.Task)
	if len(spec.Steps) > 0 {
		lines = append(lines, "## 순서")
		for i, step := range spec.Steps {
			lines = append(lines, strconv.Itoa(i+1)+". "+step)
		}
	}
	bullets := func(title string, items []string) {
		if len(items) > 0 {
			lines = append(lines, "## "+title)
			for _, item := range items {
				lines = append(lines, "- "+item)
			}
		}
	}
	bullets("규칙", spec.Rules)
	lines = append(lines, "## 통과 기준", "반환하기 전에 각 항목을 하나씩 확인한다. 하나라도 '아니오'이면 고친 뒤 반환한다.")
	for _, criterion := range spec.Criteria {
		lines = append(lines, "- "+criterion)
	}
	lines = append(lines, "## 출력")
	if !reused {
		lines = append(lines, shared.Guard["output"])
	}
	lines = append(lines, string(spec.Example))
	for _, note := range spec.OutputNotes {
		lines = append(lines, "- "+note)
	}
	guards := spec.Guards
	defaultGuards := len(guards) == 0
	if defaultGuards {
		guards = []string{shared.Guard["noTools"]}
	}
	if reused {
		keys := strings.Join(omitted, ", ")
		if keys == "" {
			keys = "없음"
		}
		items := []string{
			"같은 대화의 이전 과업은 종료되었다. 이번 메시지의 지시와 출력 형식만 따른다. 첫 과업의 '역할', '지킬 것', 출력 규칙 및 이전에 전달받은 자료(키: " + keys + ")는 그대로 유효하며, 아래 <자료>에는 새로 생성되었거나 변경된 항목만 포함되어 있다.",
			shared.Guard["trust"],
		}
		// 도구 규칙은 과업마다 다를 수 있어 기본값이 아닐 때 다시 싣는다
		if !defaultGuards {
			items = append(items, guards...)
		}
		bullets("지킬 것", items)
	} else {
		bullets("지킬 것", append(append([]string{shared.Guard["trust"]}, guards...), shared.Guard["noFabrication"]))
	}
	lines = append(lines, "<자료>", strings.ReplaceAll(string(data), "</", `<\/`), "</자료>",
		"위 자료를 바탕으로 '이번 일'을 마치고 '통과 기준'을 모두 확인한 뒤, '출력' 형식에 맞는 JSON 객체 하나만 반환한다.")
	return strings.Join(lines, "\n")
}
