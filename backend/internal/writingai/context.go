package writingai

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"maps"
	"slices"
	"strings"

	"github.com/pollux-o4/AIN/backend/internal/writing"
)

type field struct {
	key string
	raw json.RawMessage
}

type ordered []field

func (o *ordered) set(key string, value json.RawMessage) {
	if len(value) == 0 {
		return
	}
	for i := range *o {
		if (*o)[i].key == key {
			(*o)[i].raw = value
			return
		}
	}
	*o = append(*o, field{key, value})
}

func (o ordered) get(key string) json.RawMessage {
	for _, item := range o {
		if item.key == key {
			return item.raw
		}
	}
	return nil
}

func (o ordered) raw() json.RawMessage {
	result := []byte{'{'}
	for i, entry := range o {
		if i != 0 {
			result = append(result, ',')
		}
		result = append(result, encode(entry.key)...)
		result = append(result, ':')
		result = append(result, encode(entry.raw)...)
	}
	return append(result, '}')
}

var inputs = map[string][]string{
	"diagnose": {},
	"topic":    {"diagnose"},
	"audience": {"diagnose", "topic"},
	"value":    {"diagnose", "topic", "audience"},
	"research": {"diagnose", "topic", "audience", "value"},
	"outline":  {"diagnose", "topic", "audience", "value", "research"},
	"draft":    {"diagnose", "topic", "audience", "value", "research", "outline"},
	"review":   {"diagnose", "audience", "value", "research", "outline", "draft"},
	"route":    {"diagnose", "topic", "audience", "value", "research", "outline", "draft", "review"},
}

func contextOf(state map[string]json.RawMessage, stage string, input actionInput, requirements ordered) (ordered, ordered) {
	var artifacts ordered
	source := fields(state["artifacts"])
	for _, key := range inputs[stage] {
		artifacts.set(key, fields(source[key])["output"])
	}
	data := ordered{}
	data.set("source", state["source"])
	data.set("idea", state["idea"])
	if len(requirements) != 0 {
		data.set("requirements", requirements.raw())
	}
	data.set("artifacts", artifacts.raw())
	if truthy(state["brief"]) && slices.Contains([]string{"outline", "draft", "review"}, stage) {
		data.set("brief", state["brief"])
	}
	if text := stringOf(fields(artifacts.get("draft"))["text"]); (stage == "review" || stage == "route") && present(fields(artifacts.get("draft"))["text"]) {
		data.set("draftCharacterCount", encode(readerCount(text)))
		data.set("draftMetrics", encode(measureDraft(text, fields(artifacts.get("outline")))))
	}
	data.set("baseline", baselineOf(state, stage, input))
	if input.Section == nil {
		retry := fields(state["retry"])
		if stringOf(retry["stage"]) == stage {
			data.set("retryNote", retry["note"])
		}
	} else {
		parts := values(state["draftParts"])
		if len(parts) != 0 {
			last := fields(parts[len(parts)-1])["text"]
			if truthy(last) {
				data.set("previousSection", last)
			}
		}
		if input.Section.Index == input.Section.Total-1 {
			var closings []string
			for _, part := range parts {
				if closing := closingLine(stringOf(fields(part)["text"])); closing != "" {
					closings = append(closings, closing)
				}
			}
			if len(closings) != 0 {
				data.set("previousClosings", encode(closings))
			}
		}
	}
	if present(state["feedback"]) {
		data.set("feedback", state["feedback"])
	}
	return data, artifacts
}

func baselineOf(state map[string]json.RawMessage, stage string, input actionInput) json.RawMessage {
	rejected := input.Rejected
	if input.Section != nil {
		rejected = input.Section.Rejected
	}
	if rejected != "" {
		return encode(rejected)
	}
	history := values(state["history"])
	if len(history) == 0 {
		return nil
	}
	previous := fields(fields(history[len(history)-1])["artifacts"])
	lastDraft := fields(fields(previous["draft"])["output"])["text"]
	if input.Mode == "edit" {
		return lastDraft
	}
	point := stringOf(state["routeTarget"])
	if !present(state["routeTarget"]) {
		point = stage
	}
	if stage == "route" || stage == "review" || !truthy(state["feedback"]) || stage != point {
		return nil
	}
	if input.Section == nil {
		return fields(previous[stage])["output"]
	}
	lead, sections := splitArticle(stringOf(lastDraft))
	var parts []string
	if len(sections) == input.Section.Total && len(sections) > 0 {
		parts = append([]string{lead + sections[0]}, sections[1:]...)
	} else {
		parts = append([]string{lead}, sections...)
	}
	if len(parts) == input.Section.Total {
		return encode(strings.TrimRightFunc(parts[input.Section.Index], jsSpace))
	}
	return nil
}

func standing(state map[string]json.RawMessage) ordered {
	var result ordered
	set := func(kind string, value, quote json.RawMessage) {
		if kind != "" {
			result.set(kind, ordered{{"value", value}, {"quote", quote}}.raw())
		}
	}
	log := values(state["requirementLog"])
	if log == nil {
		direction := fields(state["direction"])
		for _, key := range []string{"mode", "readerLevel"} {
			if value := stringOf(direction[key]); value != "" && value != "auto" {
				set(key, direction[key], encode("의뢰 화면 선택"))
			}
		}
		if target := direction["targetLength"]; present(target) {
			set("length", target, encode("의뢰 화면 선택"))
		} else if length := fields(fields(state["brief"])["acceptance"])["length"]; present(length) {
			set("length", length, encode("이전 기록"))
		} else if length := writing.LegacyLengthFromState(state); present(length) {
			set("length", length, encode("이전 기록"))
		}
		return result
	}
	for _, entry := range log {
		for _, item := range values(fields(entry)["changes"]) {
			change := fields(item)
			key := stringOf(change["kind"])
			if stringOf(change["op"]) == "lift" {
				result = slices.DeleteFunc(result, func(value field) bool { return value.key == key })
			} else if present(change["value"]) && len(change["quote"]) != 0 {
				set(key, change["value"], change["quote"])
			}
		}
	}
	return result
}

func requirement(requirements ordered, key string) string {
	return stringOf(fields(requirements.get(key))["value"])
}

func direction(state map[string]json.RawMessage, requirements ordered) ([]string, string) {
	artifacts := fields(state["artifacts"])
	diagnosis := fields(fields(artifacts["diagnose"])["output"])
	mode, level := requirement(requirements, "mode"), requirement(requirements, "readerLevel")
	if mode == "" {
		mode = stringOf(diagnosis["primaryMode"])
	}
	if level == "" {
		level = stringOf(diagnosis["readerLevel"])
	}
	present := map[string]bool{mode: true}
	for _, card := range values(fields(fields(artifacts["outline"])["output"])["sections"]) {
		present[stringOf(fields(card)["mode"])] = true
	}
	var modes []string
	for _, mode := range templates.Modes {
		if present[mode] {
			modes = append(modes, mode)
		}
	}
	return modes, level
}

func fingerprints(data, artifacts ordered, delivered map[string]string) map[string]string {
	next := make(map[string]string, len(delivered)+len(data)+len(artifacts))
	maps.Copy(next, delivered)
	for _, item := range data {
		if item.key != "artifacts" {
			next[item.key] = fingerprint(item.raw)
		}
	}
	for _, item := range artifacts {
		next["artifacts."+item.key] = fingerprint(item.raw)
	}
	return next
}

func fingerprint(raw json.RawMessage) string {
	digest := sha256.Sum256(encode(raw))
	return hex.EncodeToString(digest[:8])
}

func delta(data, artifacts ordered, previous, next map[string]string) (ordered, []string) {
	var result, changed ordered
	var omitted []string
	for _, item := range data {
		if item.key == "artifacts" {
			continue
		}
		if previous[item.key] == next[item.key] {
			omitted = append(omitted, item.key)
		} else {
			result = append(result, item)
		}
	}
	for _, item := range artifacts {
		key := "artifacts." + item.key
		if previous[key] == next[key] {
			omitted = append(omitted, key)
		} else {
			changed = append(changed, item)
		}
	}
	if len(changed) > 0 {
		result.set("artifacts", changed.raw())
	}
	return result, omitted
}
