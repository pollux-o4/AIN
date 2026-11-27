package writingai

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
)

func validateOutline(output object) bool {
	if !required(output, "rationale") || !maybeText(output, "title") {
		return false
	}
	if raw, ok := output["analogySystem"]; ok {
		value := fields(raw)
		if !required(value, "source") || !stringList(value["mapping"]) || !stringList(value["limits"]) {
			return false
		}
	}
	sections := values(output["sections"])
	if len(sections) == 0 {
		return false
	}
	for i, raw := range sections {
		if nonempty(raw) {
			continue
		}
		card := fields(raw)
		if !required(card, "mode", "title", "keyPoint") ||
			!enumIfPresent(card, "mode", templates.Modes) || !enumIfPresent(card, "level", templates.Levels) ||
			!optionalLists(card, "cases") ||
			!maybeText(card, "prerequisite", "concrete", "walkthrough", "refute", "checkQuestion", "hook", "principleLine", "underline") {
			return false
		}
		if optional, ok := card["optional"]; ok && !boolean(optional) {
			return false
		}
		if budget, ok := card["budget"]; ok {
			if value, ok := positiveInteger(budget); ok {
				card["budget"] = encode(value)
			} else {
				delete(card, "budget")
			}
		}
		normalizeSubsections(card)
		sections[i] = encode(card)
	}
	output["sections"] = encode(sections)
	return true
}

func positiveInteger(raw json.RawMessage) (int64, bool) {
	text := string(raw)
	if isString(raw) {
		text = strings.TrimFunc(stringOf(raw), jsSpace)
	}
	if text == "true" {
		return 1, true
	}
	value, err := strconv.ParseFloat(text, 64)
	if err == nil && value > 0 && value <= 1<<53-1 && math.Trunc(value) == value {
		return int64(value), true
	}
	return 0, false
}

func normalizeSubsections(parent object) {
	raw, ok := parent["subsections"]
	if !ok {
		return
	}
	items := values(raw)
	if items == nil {
		delete(parent, "subsections")
		return
	}
	for i, raw := range items {
		item := fields(raw)
		if !required(item, "title") || !maybeText(item, "keyPoint") {
			delete(parent, "subsections")
			return
		}
		normalizeSubsections(item)
		items[i] = encode(item)
	}
	parent["subsections"] = encode([]json.RawMessage(items))
}
