package writing

import (
	"errors"
	"fmt"
	"sort"
	"strings"
)

func baseline(state object) (string, bool) {
	value, ok := obj(obj(obj(latestHistory(state)["artifacts"])["draft"])["output"])["text"].(string)
	return value, ok
}

func marksChanges(state object) bool {
	_, exists := baseline(state)
	return exists && state["stage"] == "draft" && state["routeTarget"] == "draft" &&
		isOneOf(str(obj(state["brief"])["level"]), "line", "copy")
}

type edit struct {
	find, replace string
}

type span struct {
	index, first, end int
}

func acceptEdits(state, output object) (object, error) {
	raw := array(output["edits"])
	if len(raw) == 0 || !text(output["changeSummary"]) {
		return nil, errors.New("Invalid draft edits")
	}
	edits := make([]edit, len(raw))
	for i, item := range raw {
		fields := obj(item)
		find := str(fields["find"])
		replace, ok := fields["replace"].(string)
		if find == "" || !ok {
			return nil, errors.New("Invalid draft edits")
		}
		edits[i] = edit{find, replace}
	}
	before, _ := baseline(state)
	positions, issues := locateEdits(before, edits)
	if len(issues) > 0 {
		note := "변경 표시를 적용하지 못하였다: " + strings.Join(issues, " / ") + "."
		reject(state, "draft", -1, nil, draftIssue{note, "변경 표시 적용 실패가 반복됨: " + note})
		return nil, nil
	}
	delete(state, "retry")
	after := before
	for i := len(positions) - 1; i >= 0; i-- {
		p := positions[i]
		after = after[:p.first] + edits[p.index].replace + after[p.end:]
	}
	for _, stage := range []string{"outline", "value"} {
		artifact := obj(obj(state["artifacts"])[stage])
		if raw := artifact["output"]; raw != nil {
			artifact["output"] = syncCards(raw, before, after, edits)
		}
	}
	normalized := make([]any, len(edits))
	for i, item := range edits {
		normalized[i] = object{"find": item.find, "replace": item.replace}
	}
	return object{"text": after, "changeSummary": output["changeSummary"], "edits": normalized}, nil
}

func locateEdits(text string, edits []edit) ([]span, []string) {
	var positions []span
	var issues []string
	for i, item := range edits {
		offset := strings.Index(text, item.find)
		switch {
		case offset < 0:
			issues = append(issues, fmt.Sprintf("%d번 find가 baseline에 없다", i+1))
		case strings.Contains(text[offset+1:], item.find):
			issues = append(issues, fmt.Sprintf("%d번 find가 baseline에 여러 번 나온다(앞뒤를 더 포함해 한 곳만 가리킨다)", i+1))
		default:
			positions = append(positions, span{i, offset, offset + len(item.find)})
		}
	}
	sort.SliceStable(positions, func(i, j int) bool { return positions[i].first < positions[j].first })
	for i, item := range positions {
		if i > 0 && item.first < positions[i-1].end {
			issues = append(issues, fmt.Sprintf("%d번과 %d번 find가 겹친다", positions[i-1].index+1, item.index+1))
		}
	}
	return positions, issues
}

func syncCards(value any, before, after string, edits []edit) any {
	switch tree := value.(type) {
	case string:
		if !strings.Contains(before, tree) || strings.Contains(after, tree) {
			return tree
		}
		for _, item := range edits {
			if strings.Contains(tree, item.find) {
				return strings.Replace(tree, item.find, item.replace, 1)
			}
			start := strings.Index(item.find, tree)
			if start < 0 {
				continue
			}
			lead, tail := item.find[:start], item.find[start+len(tree):]
			if len(item.replace) >= len(lead)+len(tail) && strings.HasPrefix(item.replace, lead) && strings.HasSuffix(item.replace, tail) {
				if replacement := strings.TrimSpace(item.replace[len(lead) : len(item.replace)-len(tail)]); replacement != "" {
					return replacement
				}
			}
		}
	case []any:
		copy := make([]any, len(tree))
		for i, node := range tree {
			copy[i] = syncCards(node, before, after, edits)
		}
		return copy
	case map[string]any:
		copy := object{}
		for key, node := range tree {
			copy[key] = syncCards(node, before, after, edits)
		}
		return copy
	}
	return value
}
