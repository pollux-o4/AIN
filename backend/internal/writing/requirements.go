package writing

import (
	"fmt"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"
)

func formChanges(direction object) []any {
	var changes []any
	for _, kind := range []string{"mode", "readerLevel"} {
		if value := direction[kind]; text(value) && value != "auto" {
			changes = append(changes, object{"kind": kind, "op": "set", "value": value, "quote": "의뢰 화면 선택"})
		}
	}
	if length := direction["targetLength"]; length != nil {
		changes = append(changes, object{"kind": "length", "op": "set", "value": length, "quote": "의뢰 화면 선택"})
	}
	return changes
}

func coerceInt(value any) int64 {
	if text, ok := value.(string); ok {
		parsed, err := strconv.ParseFloat(strings.TrimSpace(text), 64)
		if err != nil {
			return -1
		}
		value = parsed
	}
	return intValue(value)
}

func normalizeLength(value any) object {
	length := obj(value)
	min := coerceInt(length["min"])
	rawMax, exists := length["max"]
	if min < 0 || !exists {
		return nil
	}
	if rawMax == nil {
		return object{"min": num(min), "max": nil}
	}
	max := coerceInt(rawMax)
	if max < 1 || max < min {
		return nil
	}
	return object{"min": num(min), "max": num(max)}
}

func recordChanges(state object, source string, changes any) {
	var valid []any
	for _, item := range array(changes) {
		change := obj(item)
		kind, ok := change["kind"].(string)
		if !ok {
			continue
		}
		row := object{"kind": kind, "op": change["op"], "quote": strings.TrimSpace(str(change["quote"]))}
		switch change["op"] {
		case "lift":
			valid = append(valid, row)
		case "set":
			value := change["value"]
			switch kind {
			case "length":
				length := normalizeLength(value)
				if length == nil {
					continue
				}
				value = length
			case "mode":
				if !slices.Contains(modes, str(value)) {
					continue
				}
			case "readerLevel":
				if !slices.Contains(levels, str(value)) {
					continue
				}
			default:
				if !text(value) {
					continue
				}
				value = strings.TrimSpace(str(value))
			}
			row["value"] = value
			valid = append(valid, row)
		}
	}
	if len(valid) != 0 {
		state["requirementLog"] = append(array(state["requirementLog"]), object{
			"revision": state["revision"], "source": source, "changes": valid,
		})
	}
}

func ensureLog(state object) {
	if array(state["requirementLog"]) != nil {
		return
	}
	state["requirementLog"] = []any{}
	direction := obj(state["direction"])
	changes := formChanges(direction)
	if direction["targetLength"] == nil {
		if length := legacyLength(state); length != nil {
			changes = append(changes, object{"kind": "length", "op": "set", "value": length, "quote": "이전 기록"})
		}
	}
	tmp := object{"requirementLog": state["requirementLog"], "revision": num(1)}
	recordChanges(tmp, "form", changes)
	state["requirementLog"] = tmp["requirementLog"]
}

// The original store shipped before the requirement ledger. These patterns
// are limited to migrating explicitly stated length values for those records.
var legacyPatterns = []struct {
	re     *regexp.Regexp
	bounds func(float64, float64) (float64, float64)
}{
	{regexp.MustCompile(`(\d[\d,]*)\s*자?\s*[~\-–]\s*(\d[\d,]*)\s*자`), func(a, b float64) (float64, float64) { return a, b }},
	{regexp.MustCompile(`(\d[\d,]*)\s*자\s*\(?\s*±\s*(\d+)\s*%`), func(a, b float64) (float64, float64) { return a * (1 - b/100), a * (1 + b/100) }},
	{regexp.MustCompile(`(\d[\d,]*)\s*자\s*(?:안팎|내외|정도|전후|가량)`), func(a, _ float64) (float64, float64) { return a * .9, a * 1.1 }},
	{regexp.MustCompile(`(\d[\d,]*)\s*자\s*(?:이내|이하|까지)`), func(a, _ float64) (float64, float64) { return 0, a }},
	{regexp.MustCompile(`(\d[\d,]*)\s*자\s*(?:이상|넘게)`), func(a, _ float64) (float64, float64) { return a, -1 }},
}

func legacyLength(state object) any {
	if length := obj(obj(state["brief"])["acceptance"])["length"]; length != nil {
		return length
	}
	texts := []string{}
	if state["feedbackSource"] != "auto" {
		texts = append(texts, str(state["feedback"]))
	}
	history := array(state["history"])
	for i := len(history) - 1; i >= 0; i-- {
		item := obj(history[i])
		if item["feedbackSource"] != "auto" {
			texts = append(texts, str(item["feedback"]))
		}
	}
	texts = append(texts, str(state["idea"]))
	for _, text := range texts {
		for _, pattern := range legacyPatterns {
			match := pattern.re.FindStringSubmatch(text)
			if match == nil {
				continue
			}
			a, err := strconv.ParseFloat(strings.ReplaceAll(match[1], ",", ""), 64)
			if err != nil {
				continue
			}
			var b float64
			if len(match) > 2 {
				b, err = strconv.ParseFloat(strings.ReplaceAll(match[2], ",", ""), 64)
				if err != nil {
					continue
				}
			}
			min, max := pattern.bounds(a, b)
			min, max = math.Round(min), math.Round(max)
			if max == -1 && min >= 100 {
				return object{"min": min, "max": nil}
			}
			if max >= 100 && min <= max {
				return object{"min": min, "max": max}
			}
		}
	}
	return nil
}

func requiredLength(state object) object {
	if array(state["requirementLog"]) == nil {
		direction := obj(state["direction"])
		if target := obj(direction["targetLength"]); target != nil {
			return target
		}
		return normalizeLength(legacyLength(state))
	}
	var length object
	for _, entry := range array(state["requirementLog"]) {
		for _, item := range array(obj(entry)["changes"]) {
			change := obj(item)
			if change["kind"] == "length" {
				length = obj(change["value"])
			}
		}
	}
	return length
}

var markdownLink = regexp.MustCompile(`\]\([^)]*\)`)
var headings = regexp.MustCompile(`(?m)^##\s`)

func readerLength(value string) int64 {
	return int64(utf8.RuneCountInString(markdownLink.ReplaceAllString(value, "]")))
}

func unmetRequirements(state object) []any {
	length := requiredLength(state)
	draft := str(obj(obj(obj(state["artifacts"])["draft"])["output"])["text"])
	if length == nil || draft == "" {
		return nil
	}
	minimum, maximum := intValue(length["min"]), intValue(length["max"])
	actual := readerLength(draft)
	over := maximum > 0 && actual > maximum
	if !over && actual >= minimum {
		return nil
	}
	rangeText := fmt.Sprintf("%d자 이상", minimum)
	if maximum > 0 {
		rangeText = fmt.Sprintf("%d~%d자", minimum, maximum)
	}
	how := fmt.Sprintf("약 %d자를 부족한 구간 설명·예시로 보강한다", minimum-actual)
	if over {
		mid := minimum + (maximum-minimum+1)/2
		how = fmt.Sprintf("약 %d자를 구간·예시 삭제로 줄인다(문장 다듬기로는 부족)", actual-mid)
	}
	target := "outline"
	if state["feedbackSource"] == "auto" {
		target = "draft"
	}
	return []any{object{
		"kind": "length", "target": target, "actual": num(actual), "required": length,
		"message": fmt.Sprintf("요구사항 미충족(분량): %d자 · 요구 %s. %s. 현재 구간별: %s.", actual, rangeText, how, strings.Join(sectionCounts(draft), " / ")),
	}}
}

func sectionCounts(draft string) []string {
	starts := []int{0}
	for _, match := range headings.FindAllStringIndex(draft, -1) {
		if match[0] != 0 {
			starts = append(starts, match[0])
		}
	}
	ends := append(append([]int{}, starts[1:]...), len(draft))
	parts := make([]string, len(starts))
	for i := range starts {
		parts[i] = draft[starts[i]:ends[i]]
	}
	firstSection := 1
	if strings.HasPrefix(draft, "## ") {
		firstSection = 0
	}
	for i := firstSection + 1; i < len(parts); i++ {
		first, _, _ := strings.Cut(parts[i], "\n")
		if strings.TrimSpace(first) == "## 한눈에 정리" {
			parts[i-1] = strings.Join(parts[i-1:], "")
			parts = parts[:i]
			break
		}
	}
	counts := make([]string, 0, len(parts))
	for _, part := range parts {
		if part == "" {
			continue
		}
		first, _, _ := strings.Cut(part, "\n")
		title := []rune(strings.TrimLeft(strings.TrimLeft(first, "#"), " \t"))
		counts = append(counts, fmt.Sprintf("%s %d자", string(title[:min(len(title), 30)]), readerLength(part)))
	}
	return counts
}
