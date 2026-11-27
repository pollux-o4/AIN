package writing

import (
	"fmt"
	"reflect"
	"slices"
)

var modes = []string{"explain", "procedure", "argue", "narrate"}
var levels = []string{"beginner", "intermediate", "expert"}

func stateEnvelope(state object) bool {
	return intValue(state["schemaVersion"]) == 1 && intValue(state["version"]) >= 1 &&
		intValue(state["revision"]) >= 1 && array(state["history"]) != nil && obj(state["seen"]) != nil
}

func (rules *Rules) issue(state object) string {
	_, sourceOK := state["source"].(string)
	_, ideaOK := state["idea"].(string)
	if !stateEnvelope(state) || !text(state["articleId"]) || !sourceOK || !ideaOK ||
		(!text(state["source"]) && !text(state["idea"])) {
		return "Invalid state envelope"
	}
	if _, err := normalizeDirection(state); err != nil {
		return err.Error()
	}
	if plan, exists := state["plan"]; exists && !fullPlan(plan) {
		return "Invalid editorial plan: full STAGES required"
	}
	stage := str(state["stage"])
	index := slices.Index(stages, stage)
	if index < 0 {
		return "Invalid editorial stage"
	}
	status := str(state["status"])
	if isOneOf(status, "paused", "failed") {
		wasFailed := status == "failed"
		status = str(state["resumeStatus"])
		if isOneOf(status, "paused", "failed") {
			return "Invalid resume status"
		}
		if wasFailed && !isOneOf(status, "waiting_ai", "waiting_route", "waiting_figure") {
			return "Invalid failed work status"
		}
	}
	figureStatus := isFigureStatus(status)
	if !figureStatus && !isOneOf(status, "waiting_ai", "waiting_route", "awaiting_brief", "awaiting_user", "satisfied", "publication_ready") {
		return "Invalid editorial status"
	}
	if status != "waiting_ai" && stage != "review" {
		return "Presented or routed work requires review stage"
	}
	revision := intValue(state["revision"])
	if isOneOf(status, "waiting_route", "awaiting_brief") {
		previous := latestHistory(state)
		if intValue(previous["revision"]) != revision-1 {
			return "Missing prior complete revision for feedback route"
		}
		if p, ok := previous["plan"]; ok && !fullPlan(p) {
			return "Prior revision requires full STAGES"
		}
		for _, candidate := range []object{previous, state} {
			if issue := artifactsIssue(candidate["artifacts"], stages, revision-1); issue != "" {
				return issue
			}
		}
		for _, name := range stages {
			if !reflect.DeepEqual(obj(state["artifacts"])[name], obj(previous["artifacts"])[name]) {
				return "Feedback prerequisite differs from prior revision: " + name
			}
		}
		return ""
	}
	required := stages
	if status == "waiting_ai" {
		required = stages[:index]
	}
	if issue := artifactsIssue(state["artifacts"], required, revision); issue != "" {
		return issue
	}
	if (figureStatus || isOneOf(status, "satisfied", "publication_ready")) && intValue(state["satisfiedRevision"]) != revision {
		return "Satisfaction must reference current revision"
	}
	if approval := obj(state["approval"]); status == "publication_ready" &&
		(intValue(approval["revision"]) != revision || !text(approval["eventId"])) {
		return "Publication approval must reference current revision"
	}
	if rules.figures != nil {
		return rules.figures.Issue(state, status)
	}
	if figureStatus {
		return "Visual-material rules required"
	}
	return ""
}

func isFigureStatus(status string) bool {
	return isOneOf(status, "waiting_figure", "awaiting_figure_choice", "awaiting_figure_design", "awaiting_figure_review")
}

func artifactsIssue(value any, required []string, revision int64) string {
	artifacts := obj(value)
	if artifacts == nil {
		return "Artifacts must be an object"
	}
	for _, stage := range required {
		artifact := obj(artifacts[stage])
		if artifact == nil {
			return "Missing prerequisite artifact: " + stage
		}
		if intValue(artifact["revision"]) != revision {
			return "Wrong revision for prerequisite artifact: " + stage
		}
		if err := validateOutput(stage, obj(artifact["output"])); err != nil {
			return fmt.Sprintf("Invalid prerequisite artifact: %s: %s", stage, err)
		}
	}
	return ""
}

func normalizeDirection(source object) (object, error) {
	result := object{"mode": "auto", "readerLevel": "auto"}
	value, exists := source["direction"]
	if !exists {
		return result, nil
	}
	direction := obj(value)
	if direction == nil {
		return nil, fmt.Errorf("Invalid editorial direction")
	}
	for _, rule := range []struct {
		key     string
		entries []string
	}{{"mode", modes}, {"readerLevel", levels}} {
		if v, exists := direction[rule.key]; exists {
			if v != "auto" && !slices.Contains(rule.entries, str(v)) {
				return nil, fmt.Errorf("Invalid editorial direction")
			}
			result[rule.key] = v
		}
	}
	if v, exists := direction["targetLength"]; exists {
		r := obj(v)
		min, max := intValue(r["min"]), intValue(r["max"])
		if min < 0 || max < 1 || min > max {
			return nil, fmt.Errorf("Invalid editorial direction")
		}
		result["targetLength"] = object{"min": num(min), "max": num(max)}
	}
	return result, nil
}

var requiredText = map[string][]string{
	"diagnose": {"purpose", "audience", "preserveVoice", "strategy"},
	"topic":    {"problem", "scope"},
	"audience": {"reader", "intent"},
	"value":    {"outcome"},
	"outline":  {"rationale"},
	"draft":    {"text", "changeSummary"},
	"review":   {"preservationCheck"},
}

func validateOutput(stage string, output object) error {
	if !slices.Contains(stages, stage) {
		return fmt.Errorf("Unknown editorial stage")
	}
	if output == nil {
		return fmt.Errorf("Invalid %s output", stage)
	}
	for _, key := range requiredText[stage] {
		if !text(output[key]) {
			return fmt.Errorf("Nonempty text required: %s", key)
		}
	}
	switch stage {
	case "diagnose":
		if !textList(output["sectionModes"], 1) || !optionalEnum(output, "primaryMode", modes) || !optionalEnum(output, "readerLevel", levels) {
			return fmt.Errorf("Invalid diagnosis output")
		}
	case "topic":
		if !optionalLists(output, "titleCandidates") {
			return fmt.Errorf("Invalid topic output")
		}
	case "audience":
		if !optionalLists(output, "knows", "unknownTerms", "misconceptions", "homonyms") || !optionalText(output, "readerTask", "scene") {
			return fmt.Errorf("Invalid audience output")
		}
	case "value":
		if !textList(output["preserve"], 0) || !optionalLists(output, "excluded") || !optionalText(output, "promise") {
			return fmt.Errorf("Invalid value output")
		}
	case "research":
		evidence := array(output["evidence"])
		if evidence == nil || !textList(output["uncertainties"], 0) || (len(evidence) == 0 && len(array(output["uncertainties"])) == 0) {
			return fmt.Errorf("Research requires evidence or uncertainty")
		}
		for _, item := range evidence {
			if !text(obj(item)["claim"]) || !text(obj(item)["url"]) {
				return fmt.Errorf("Invalid research evidence")
			}
		}
	case "outline":
		if !optionalText(output, "title") || len(array(output["sections"])) == 0 {
			return fmt.Errorf("Invalid outline sections")
		}
		for _, item := range array(output["sections"]) {
			if text(item) {
				continue
			}
			card := obj(item)
			if !text(card["title"]) || !text(card["keyPoint"]) || !slices.Contains(modes, str(card["mode"])) ||
				!optionalEnum(card, "level", levels) || !optionalLists(card, "cases") ||
				!optionalText(card, "prerequisite", "concrete", "walkthrough", "refute", "checkQuestion", "hook", "principleLine", "underline") {
				return fmt.Errorf("Invalid outline section card")
			}
			if optional, exists := card["optional"]; exists {
				if _, valid := optional.(bool); !valid {
					return fmt.Errorf("Invalid outline section card")
				}
			}
		}
		if value, exists := output["analogySystem"]; exists {
			analogy := obj(value)
			if !text(analogy["source"]) || !textList(analogy["mapping"], 0) || !textList(analogy["limits"], 0) {
				return fmt.Errorf("Invalid outline analogy system")
			}
		}
	case "review":
		if !textList(output["findings"], 0) {
			return fmt.Errorf("Invalid review findings")
		}
	}
	return nil
}

func textList(value any, minimum int) bool {
	list := array(value)
	if list == nil || len(list) < minimum {
		return false
	}
	for _, item := range list {
		if !text(item) {
			return false
		}
	}
	return true
}

func optionalLists(value object, fields ...string) bool {
	for _, field := range fields {
		if item, exists := value[field]; exists && !textList(item, 0) {
			return false
		}
	}
	return true
}

func optionalEnum(value object, key string, entries []string) bool {
	item, exists := value[key]
	return !exists || slices.Contains(entries, str(item))
}

func optionalText(value object, fields ...string) bool {
	for _, field := range fields {
		if value[field] != nil {
			if _, valid := value[field].(string); !valid {
				return false
			}
		}
	}
	return true
}
