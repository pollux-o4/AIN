package editorial

import (
	"encoding/json"
	"strings"
)

// Restrict provider evidence to the fields those stages publish. The saved
// JSON may contain prompt internals, diagnostics, or figure source files.
var historyResultFields = map[string][]string{
	"diagnose":       {"purpose", "audience", "primaryMode", "readerLevel", "sectionModes", "preserveVoice", "strategy"},
	"topic":          {"problem", "scope"},
	"audience":       {"reader", "intent"},
	"value":          {"outcome", "preserve"},
	"research":       {"evidence", "uncertainties"},
	"outline":        {"sections", "rationale"},
	"draft":          {"text", "changeSummary"},
	"review":         {"findings", "preservationCheck"},
	"route":          {"target", "reason"},
	"figure_plan":    {"candidates"},
	"figure_compose": {"world", "designs"},
	"figure":         {"figures"},
}

// Already retained editorial artifacts include accepted command metadata that
// live job descriptions leave out. Provider-only fields remain omitted.
var retainedHistoryFields = map[string][]string{
	"diagnose": {"requirementChanges"},
	"topic":    {"titleCandidates"},
	"audience": {"readerTask", "knows", "unknownTerms", "misconceptions", "homonyms", "scene"},
	"value":    {"excluded", "promise"},
	"research": {"cases"},
	"outline":  {"title", "analogySystem"},
	"draft":    {"edits"},
	"review":   {"verdict", "reviseFrom", "unmetCriteria", "criteria"},
}

var historyItemFields = map[string][]string{
	"evidence":           {"claim", "url"},
	"candidates":         {"claim", "anchor"},
	"figures":            {"alt", "caption"},
	"designs":            {"id", "analogy", "scene", "mapping", "motifs", "direction", "without", "look"},
	"mapping":            {"element", "concept"},
	"sections":           strings.Fields("title mode keyPoint level optional prerequisite concrete walkthrough refute checkQuestion hook cases principleLine underline subsections budget"),
	"subsections":        {"title", "keyPoint", "subsections"},
	"edits":              {"find", "replace"},
	"requirementChanges": {"kind", "value", "quote", "action"},
	"cases":              {"text", "origin"},
	"analogySystem":      {"source", "mapping", "limits"},
	"criteria":           {"name", "result", "note"},
}

func savedHistoryOutput(raw historyOutput, stage string) historyOutput {
	if raw == nil {
		return nil
	}
	return projectedHistoryOutput(raw, stage, true)
}

func projectedHistoryOutput(raw historyOutput, stage string, retained bool) historyOutput {
	selected := make(historyOutput)
	for _, field := range historyResultFields[stage] {
		if value, ok := raw[field]; ok {
			selected[field] = safeHistoryField(field, value, 0)
		}
	}
	if retained {
		for _, field := range retainedHistoryFields[stage] {
			if value, ok := raw[field]; ok {
				selected[field] = safeHistoryField(field, value, 0)
			}
		}
	}
	for name, value := range selected {
		if len(value) == 0 {
			delete(selected, name)
		}
	}
	return selected
}

func safeHistoryField(field string, value json.RawMessage, depth int) json.RawMessage {
	trimmed := strings.TrimSpace(string(value))
	if trimmed == "" || depth > 32 {
		return nil
	}
	switch trimmed[0] {
	case '{':
		var fields historyOutput
		if json.Unmarshal(value, &fields) != nil {
			return nil
		}
		selected := make(historyOutput)
		for _, key := range historyItemFields[field] {
			if child := safeHistoryField(key, fields[key], depth+1); child != nil {
				selected[key] = child
			}
		}
		encoded, _ := json.Marshal(selected)
		return encoded
	case '[':
		var entries []json.RawMessage
		if json.Unmarshal(value, &entries) != nil {
			return nil
		}
		result := make([]json.RawMessage, 0, len(entries))
		for _, entry := range entries {
			if child := safeHistoryField(field, entry, depth+1); child != nil {
				result = append(result, child)
			}
		}
		encoded, _ := json.Marshal(result)
		return encoded
	default:
		return value
	}
}
