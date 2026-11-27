package writing

import (
	"fmt"
	"math"
	"strings"
)

const maxSections = 8
const joiner = "\n\n"

type draftIssue struct{ note, failure string }

func reject(state object, stage string, index int64, rejected any, issue draftIssue) {
	retry := obj(state["retry"])
	attempts := int64(0)
	if retry["stage"] == stage && intValue(retry["index"]) == index {
		attempts = max(0, intValue(retry["attempts"]))
	}
	limit := int64(3)
	if stage == "outline" {
		limit = 1
	}
	if attempts >= limit {
		attempts = -1
		state["resumeStatus"], state["status"], state["error"] = state["status"], "failed", issue.failure
	}
	retry = object{"stage": stage, "index": num(index), "note": issue.note, "attempts": num(attempts + 1)}
	if rejected != nil {
		retry["rejected"] = rejected
	}
	state["retry"] = retry
}

func acceptOutline(state, output object) bool {
	sections := array(output["sections"])
	var issues []string
	if issue := budgetIssue(state, sections); issue != "" {
		issues = append(issues, issue)
	}
	if issue := cardIssue(sections); issue != "" {
		issues = append(issues, issue)
	}
	if size := readerLength(strings.TrimSpace(str(output["title"]))); size > 25 {
		issues = append(issues, fmt.Sprintf("글 제목을 고친다 → title %d자 → 25자 이내.", size))
	}
	if len(issues) == 0 {
		delete(state, "retry")
		return true
	}
	note := strings.Join(issues, " ")
	reject(state, "outline", 0, nil, draftIssue{note, "구성 검사 위반이 반복됨: " + note})
	return false
}

func budgetIssue(state object, sections []any) string {
	length := requiredLength(state)
	if length == nil {
		return ""
	}
	if len(sections) < 2 || len(sections) > maxSections {
		return fmt.Sprintf("구간은 2~%d개여야 한다(현재 %d개).", maxSections, len(sections))
	}
	budgets := make([]int64, len(sections))
	var sum int64
	for index, section := range sections {
		budget := coerceInt(obj(section)["budget"])
		if budget < 1 {
			return "모든 구간에 budget(공백 포함 글자 수, 양의 정수)을 적어야 한다."
		}
		budgets[index], sum = budget, sum+budget
	}
	minimum, maximum := intValue(length["min"]), intValue(length["max"])
	if maximum < 0 {
		maximum = int64(math.Round(float64(minimum) * 1.2))
	}
	if sum < minimum || sum > maximum {
		return fmt.Sprintf("budget 합계 %d자가 요구 %d~%d자 밖이다. 합계를 범위 안으로 맞추고 필요하면 구간 수를 줄인다.", sum, minimum, maximum)
	}
	var tight []string
	for index, budget := range budgets {
		if floor := sectionFloor(sections, index); budget < floor {
			tight = append(tight, fmt.Sprintf("%d번 %d자 < %d자", index+1, budget, floor))
		}
	}
	fewest := sections[:2]
	if len(tight) > 0 && sectionFloor(fewest, 0)+sectionFloor(fewest, 1) <= maximum {
		return "구간 budget이 항목을 옮길 지면보다 작다 → " + strings.Join(tight, " / ") + ". 구간 수를 줄여 구간마다 지면을 확보한다."
	}
	return ""
}

func storyCard(section any) bool {
	return isOneOf(str(obj(section)["mode"]), "explain", "argue", "narrate")
}

func sectionFloor(sections []any, index int) int64 {
	var floor int64
	if storyCard(sections[index]) {
		floor += 260
	}
	if index == 0 {
		floor += 160
	}
	if index == len(sections)-1 {
		floor += int64(30 * len(sections))
	}
	return floor
}

func cardIssue(sections []any) string {
	var gaps []string
	for i, raw := range sections {
		if !storyCard(raw) {
			continue
		}
		section := obj(raw)
		var missing []string
		for _, key := range []string{"hook", "cases", "principleLine", "underline"} {
			if key == "cases" && !textList(section[key], 1) || key != "cases" && !text(section[key]) {
				missing = append(missing, key)
			}
		}
		if len(array(section["cases"])) > 3 {
			missing = append(missing, "cases는 3개 이하")
		}
		for _, slot := range []struct {
			key   string
			limit int64
		}{{"hook", 50}, {"underline", 45}, {"principleLine", 40}} {
			if size := readerLength(strings.TrimSpace(str(section[slot.key]))); size > slot.limit {
				missing = append(missing, fmt.Sprintf("%s %d자 → %d자 이내", slot.key, size, slot.limit))
			}
		}
		if len(missing) > 0 {
			gaps = append(gaps, fmt.Sprintf("%d번 \"%s\": %s", i+1, titleOf(raw), strings.Join(missing, "·")))
		}
	}
	if len(gaps) == 0 {
		return ""
	}
	return "구간 카드의 항목을 고친다(빈 항목은 채우고 긴 항목은 줄인다) → " + strings.Join(gaps, " / ") + "."
}

func titleOf(section any) string {
	if title, valid := section.(string); valid {
		return title
	}
	return strings.TrimSpace(str(obj(section)["title"]))
}

func draftAction(state, action object) {
	retry := obj(state["retry"])
	if marksChanges(state) {
		action["mode"] = "edit"
		if retry["stage"] == "draft" {
			action["retryNote"] = retry["note"]
		}
		return
	}
	if section := currentSection(state); section != nil {
		action["section"] = section
	} else if retry["stage"] == "draft" {
		addRetryFields(action, retry)
	}
}

func addRetryFields(action, retry object) {
	action["retryNote"] = retry["note"]
	if rejected, exists := retry["rejected"]; exists {
		action["rejected"] = rejected
	}
}

func currentSection(state object) object {
	sections := array(obj(obj(obj(state["artifacts"])["outline"])["output"])["sections"])
	parts := array(state["draftParts"])
	index := len(parts)
	if len(sections) < 2 || len(sections) > maxSections || index >= len(sections) {
		return nil
	}
	budgets := make([]int64, len(sections))
	hasBudget := false
	for i, section := range sections {
		budgets[i] = max(0, coerceInt(obj(section)["budget"]))
		hasBudget = hasBudget || budgets[i] > 0
	}
	if !hasBudget {
		return nil
	}
	section := object{"index": num(int64(index)), "total": num(int64(len(sections))), "title": titleOf(sections[index]), "budget": nil}
	if budget := budgets[index]; budget > 0 {
		section["budget"] = num(budget)
		own := int64(math.Round(num(budget) * 1.25))
		limit := own
		if length := requiredLength(state); length != nil {
			var written, reserved int64
			for _, part := range parts {
				written += readerLength(str(obj(part)["text"]) + joiner)
			}
			for _, next := range budgets[index+1:] {
				reserved += next + int64(len(joiner))
			}
			if maximum := intValue(length["max"]); maximum > 0 {
				limit = max(budget, min(own, maximum-written-reserved))
			}
			if floor := intValue(length["min"]) - written; index == len(sections)-1 && floor > 0 {
				section["floor"] = num(floor)
			}
		}
		section["limit"] = num(limit)
	}
	if retry := obj(state["retry"]); retry["stage"] == "draft" && intValue(retry["index"]) == int64(index) {
		addRetryFields(section, retry)
	}
	return section
}

func acceptDraft(state, output, section object) object {
	draft := str(output["text"])
	index := max(0, intValue(section["index"]))
	issue := draftIssue{}
	if index == 0 {
		issue = leadIssue(state, draft)
	}
	if issue.note == "" && section != nil {
		issue = sizeIssue(section, readerLength(draft))
	}
	if issue.note != "" {
		reject(state, "draft", index, draft, issue)
		return nil
	}
	delete(state, "retry")
	if section == nil {
		return output
	}
	parts := append(array(state["draftParts"]), object{"text": strings.TrimSpace(draft), "summary": output["changeSummary"]})
	state["draftParts"] = parts
	if int64(len(parts)) < intValue(section["total"]) {
		return nil
	}
	texts, summaries := make([]string, len(parts)), make([]string, len(parts))
	for i, part := range parts {
		texts[i], summaries[i] = str(obj(part)["text"]), str(obj(part)["summary"])
	}
	delete(state, "draftParts")
	return object{"text": strings.Join(texts, joiner), "changeSummary": strings.Join(summaries, " ")}
}

func leadIssue(state object, draft string) draftIssue {
	title := strings.TrimSpace(str(obj(obj(obj(state["artifacts"])["outline"])["output"])["title"]))
	first, _, _ := strings.Cut(strings.TrimSpace(draft), "\n")
	first = strings.Join(strings.Fields(first), " ")
	expected := "# 제목"
	if title != "" {
		expected = "# " + strings.Join(strings.Fields(title), " ")
		if first == expected {
			return draftIssue{}
		}
	} else if strings.HasPrefix(first, "# ") {
		return draftIssue{}
	}
	return draftIssue{
		fmt.Sprintf("원고는 '%s' 줄로 시작하고, 이어서 도입부를 쓴 뒤 첫 소제목으로 들어간다.", expected),
		"초고가 3회 다시 써도 글 제목 줄로 시작하지 않음.",
	}
}

func sizeIssue(section object, size int64) draftIssue {
	limit, floor := intValue(section["limit"]), intValue(section["floor"])
	if budget := intValue(section["budget"]); limit > 0 && size > limit {
		return draftIssue{
			fmt.Sprintf("직전 작성 %d자 · 예산 %d자 · 한도 %d자. 약 %d자를 예시·부연 삭제로 줄여 %d자 안팎으로 다시 쓴다.", size, budget, limit, size-budget, budget),
			fmt.Sprintf("\"%s\" 구간이 3회 다시 써도 한도 %d자를 넘음(%d자).", str(section["title"]), limit, size),
		}
	}
	if floor > 0 && size < floor {
		return draftIssue{
			fmt.Sprintf("직전 작성 %d자 · 글 전체 분량을 채우려면 이 구간이 %d자 이상이어야 한다. 약 %d자를 구간 카드의 사례 장면과 keyPoint 풀이로 채워 다시 쓴다.", size, floor, floor-size),
			fmt.Sprintf("\"%s\" 구간이 3회 다시 써도 %d자에 못 미침(%d자).", str(section["title"]), floor, size),
		}
	}
	return draftIssue{}
}
