package writingai

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

const resultLimit = 1024 * 1024

func (b *Builder) ValidateResult(action contract.Action, snapshot contract.Snapshot) (contract.Event, error) {
	stage, err := taskID(action)
	if err != nil {
		return contract.Event{}, err
	}
	input, err := decodeAction(action)
	if err != nil || input.Revision < 1 || action.StateVersion < 1 {
		return contract.Event{}, errors.New("writing result action lacks editorial version or revision")
	}
	fields := object{"expectedVersion": encode(action.StateVersion), "revision": encode(input.Revision)}
	switch snapshot.Status {
	case "failed", "cancelled", "stopped":
		if stage == "route" {
			stage = "review"
		}
		fields["stage"] = encode(stage)
		fields["error"] = encode("AI 작업이 완료되지 않았습니다.")
		return contract.Event{Kind: "fail", Actor: "adapter", Body: encode(fields)}, nil
	case "completed":
	default:
		return contract.Event{}, contract.ErrDeliveryUncertain
	}
	var body struct {
		DaemonTurnID string `json:"daemonTurnId"`
		Text         string `json:"text"`
	}
	if json.Unmarshal(snapshot.Body, &body) != nil || body.DaemonTurnID == "" || body.Text == "" || utf16Count(body.Text) > resultLimit {
		return contract.Event{}, errors.New("invalid or oversized writing result")
	}
	output, err := lastValid(body.Text, stage, input.Mode)
	if err != nil {
		return contract.Event{}, err
	}
	kind := "complete"
	if stage == "route" {
		kind = stage
		fields["target"], fields["reason"] = output["target"], output["reason"]
		memo := object{}
		for _, name := range []string{"level", "priorities", "preserve", "assumptions", "acceptance", "requirementChanges"} {
			if raw, ok := output[name]; ok {
				memo[name] = raw
			}
		}
		fields["brief"] = encode(memo)
	} else {
		fields["stage"], fields["output"] = encode(stage), encode(output)
		if input.Mode != "" {
			fields["mode"] = encode(input.Mode)
		}
		if input.Section != nil {
			fields["section"] = encode(input.Section.Index)
		}
	}
	return contract.Event{Kind: kind, Actor: "adapter", Body: encode(fields)}, nil
}

func lastValid(text, stage, mode string) (object, error) {
	blocks := jsonBlocks(text)
	for i := len(blocks) - 1; i >= 0; i-- {
		var output object
		if json.Unmarshal([]byte(blocks[i]), &output) == nil && output != nil && validate(stage, mode, output) {
			return output, nil
		}
	}
	return nil, fmt.Errorf("invalid %s output (%d JSON candidates)", stage, len(blocks))
}

func jsonBlocks(text string) []string {
	var result []string
	start, depth, quoted, escape := 0, 0, false, false
	for i := range len(text) {
		ch := text[i]
		if quoted {
			switch {
			case escape:
				escape = false
			case ch == '\\':
				escape = true
			case ch == '"':
				quoted = false
			}
			continue
		}
		switch ch {
		case '"':
			quoted = depth > 0
		case '{':
			if depth == 0 {
				start = i
			}
			depth++
		case '}':
			if depth > 0 {
				depth--
				if depth == 0 {
					result = append(result, text[start:i+1])
				}
			}
		}
	}
	return result
}

type object = map[string]json.RawMessage

func validate(stage, mode string, output object) bool {
	switch stage {
	case "diagnose":
		normalizeRequirementChanges(output)
		return required(output, "purpose", "audience", "preserveVoice", "strategy") &&
			listOf(output["sectionModes"], 1, nonempty) && enumIfPresent(output, "primaryMode", templates.Modes) &&
			enumIfPresent(output, "readerLevel", templates.Levels)
	case "topic":
		return required(output, "problem", "scope") && optionalLists(output, "titleCandidates")
	case "audience":
		return required(output, "reader", "intent") && maybeText(output, "readerTask", "scene") &&
			optionalLists(output, "knows", "unknownTerms", "misconceptions", "homonyms")
	case "value":
		return required(output, "outcome") && listOf(output["preserve"], 0, nonempty) &&
			maybeText(output, "promise") && optionalLists(output, "excluded")
	case "research":
		keep(output, "cases", func(raw json.RawMessage) bool {
			return listOf(raw, 0, func(v json.RawMessage) bool {
				item := fields(v)
				origin := stringOf(item["origin"])
				return required(item, "text") && (origin == "source" || origin == "hypothetical")
			})
		})
		return (len(values(output["evidence"]))+len(values(output["uncertainties"])) > 0) &&
			listOf(output["evidence"], 0, func(raw json.RawMessage) bool { return required(fields(raw), "claim", "url") }) &&
			listOf(output["uncertainties"], 0, nonempty)
	case "outline":
		return validateOutline(output)
	case "draft":
		if mode == "edit" {
			return required(output, "changeSummary") && listOf(output["edits"], 1, func(raw json.RawMessage) bool {
				item := fields(raw)
				return stringOf(item["find"]) != "" && isString(item["replace"])
			})
		}
		return required(output, "text", "changeSummary")
	case "review":
		keep(output, "checks", normalizeChecks)
		keep(output, "verdict", func(raw json.RawMessage) bool { return slices.Contains([]string{"pass", "revise"}, stringOf(raw)) })
		keep(output, "reviseFrom", isString)
		keep(output, "unmetCriteria", stringList)
		if checks, ok := output["checks"]; ok {
			list := values(checks)
			for i, raw := range list {
				item := fields(raw)
				maybeText(item, "note")
				list[i] = encode(item)
			}
			output["checks"] = encode(list)
		}
		return required(output, "preservationCheck") && stringList(output["findings"])
	case "route":
		keep(output, "level", func(raw json.RawMessage) bool {
			return slices.Contains([]string{"developmental", "line", "copy"}, stringOf(raw))
		})
		for _, key := range []string{"priorities", "preserve", "assumptions"} {
			keep(output, key, stringList)
		}
		if raw, ok := output["acceptance"]; ok {
			if acceptance := fields(raw); acceptance != nil {
				keep(acceptance, "criteria", stringList)
				output["acceptance"] = encode(acceptance)
			} else {
				delete(output, "acceptance")
			}
		}
		normalizeRequirementChanges(output)
		return isString(output["target"]) && isString(output["reason"])
	default:
		return false
	}
}

func required(output object, keys ...string) bool {
	for _, key := range keys {
		if !nonempty(output[key]) {
			return false
		}
	}
	return true
}

func isString(raw json.RawMessage) bool { return len(raw) != 0 && raw[0] == '"' }
func nonempty(raw json.RawMessage) bool { return strings.TrimFunc(stringOf(raw), jsSpace) != "" }

func maybeText(output object, keys ...string) bool {
	for _, key := range keys {
		raw := output[key]
		if !present(raw) || isString(raw) && !nonempty(raw) {
			delete(output, key)
		} else if !isString(raw) {
			return false
		}
	}
	return true
}

func enumIfPresent(output object, key string, options []string) bool {
	raw, exists := output[key]
	return !exists || slices.Contains(options, stringOf(raw))
}

func listOf(raw json.RawMessage, minimum int, each func(json.RawMessage) bool) bool {
	list := values(raw)
	if list == nil || len(list) < minimum {
		return false
	}
	for _, item := range list {
		if !each(item) {
			return false
		}
	}
	return true
}

func stringList(raw json.RawMessage) bool { return listOf(raw, 0, nonempty) }

func optionalLists(output object, keys ...string) bool {
	for _, key := range keys {
		if raw, exists := output[key]; exists && !stringList(raw) {
			return false
		}
	}
	return true
}

func keep(output object, key string, valid func(json.RawMessage) bool) {
	if raw, exists := output[key]; exists && !valid(raw) {
		delete(output, key)
	}
}

func boolean(raw json.RawMessage) bool { return string(raw) == "true" || string(raw) == "false" }

func normalizeChecks(raw json.RawMessage) bool {
	return listOf(raw, 0, func(item json.RawMessage) bool {
		check := fields(item)
		return required(check, "id") && boolean(check["pass"]) && maybeText(check, "note")
	})
}

func normalizeRequirementChanges(output object) {
	raw, ok := output["requirementChanges"]
	if !ok {
		return
	}
	items := values(raw)
	if items == nil {
		delete(output, "requirementChanges")
		return
	}
	for i, item := range items {
		change := fields(item)
		op := stringOf(change["op"])
		if !required(change, "kind", "quote") || (op != "set" && op != "lift") {
			delete(output, "requirementChanges")
			return
		}
		for _, key := range []string{"kind", "quote"} {
			change[key] = encode(strings.TrimFunc(stringOf(change[key]), jsSpace))
		}
		items[i] = encode(change)
	}
	output["requirementChanges"] = encode(items)
}
