package writing

import (
	"errors"
	"fmt"
	"reflect"
	"slices"
	"strings"
)

func (rules *Rules) apply(state, event object, issue string) error {
	kind, status := str(event["type"]), str(state["status"])
	revision := intValue(state["revision"])
	reviewed := intValue(event["reviewedRevision"]) == revision
	switch kind {
	case "complete":
		return complete(state, event)
	case "complete_requirements":
		if issue == "" {
			return errors.New("Requirements completion requires an incomplete state")
		}
		_, sourceOK := state["source"].(string)
		_, ideaOK := state["idea"].(string)
		if !text(state["articleId"]) || !sourceOK || !ideaOK || (!text(state["source"]) && !text(state["idea"])) {
			return errors.New("Article id and source or idea required")
		}
		old := object{}
		for key, value := range state {
			if key != "history" && key != "seen" {
				old[key] = value
			}
		}
		state["history"] = append(array(state["history"]), old)
		state["revision"] = num(revision + 1)
		state["plan"], state["artifacts"] = completePlan(), object{}
		state["approval"], state["satisfiedRevision"] = nil, nil
		for _, key := range []string{"resumeStatus", "error", "feedback", "routeReason", "figure"} {
			delete(state, key)
		}
		ai(state, "diagnose")
	case "feedback":
		if !isOneOf(status, "awaiting_user", "satisfied", "publication_ready") && !(isFigureStatus(status) && status != "waiting_figure") {
			return errors.New("Feedback requires a presented result")
		}
		if !reviewed || !text(event["feedback"]) {
			return errors.New("Feedback must reference current revision")
		}
		beginRevision(state, str(event["feedback"]), "person")
		state["autoCorrections"] = num(0)
		state["briefPreapproved"] = event["briefPreapproved"] == true
		state["status"] = "waiting_route"
	case "route":
		if status != "waiting_route" || intValue(event["revision"]) != revision {
			return errors.New("Unexpected or stale route")
		}
		target, reason := str(event["target"]), str(event["reason"])
		if !slices.Contains(stages, target) || !text(reason) {
			return errors.New("Route must choose diagnose or an editorial stage with a reason")
		}
		brief := object{"intent": reason}
		for key, value := range obj(event["brief"]) {
			brief[key] = value
		}
		switch brief["level"] {
		case "line", "copy":
			target = "draft"
		case "developmental":
			if slices.Index(stages, target) > slices.Index(stages, "outline") {
				target = "outline"
			}
		}
		brief["target"] = target
		state["brief"] = brief
		if state["briefPreapproved"] == true {
			return startBrief(state)
		}
		state["status"] = "awaiting_brief"
	case "approve_brief":
		if status != "awaiting_brief" || !reviewed {
			return errors.New("Brief approval requires the current proposed brief")
		}
		edit := obj(event["edit"])
		if target, exists := edit["target"]; exists && !slices.Contains(stages, str(target)) {
			return errors.New("Brief target must be an editorial stage")
		}
		brief := object{}
		for key, value := range obj(state["brief"]) {
			brief[key] = value
		}
		for key, value := range edit {
			brief[key] = value
		}
		brief["approvedBy"] = "user"
		state["brief"] = brief
		return startBrief(state)
	case "revise_brief":
		if status != "awaiting_brief" || !reviewed || !text(event["note"]) {
			return errors.New("Brief revision requires the current proposed brief and a note")
		}
		state["feedback"] = str(state["feedback"]) + "\n\n해석 보정: " + str(event["note"])
		delete(state, "brief")
		state["status"] = "waiting_route"
	case "satisfy":
		if status != "awaiting_user" || !reviewed {
			return errors.New("Satisfaction requires current presented revision")
		}
		if hasBlockingUnmet(state) {
			return errors.New("Satisfaction blocked by unmet requirements")
		}
		state["satisfiedRevision"], state["status"] = num(revision), "satisfied"
	case "authorize_publication":
		if !canAuthorize(state) || !reviewed {
			return errors.New("Separate approval for current satisfied revision required")
		}
		figures := []any{}
		for _, item := range array(obj(state["figure"])["items"]) {
			figures = append(figures, obj(item)["id"])
		}
		state["approval"] = object{"revision": num(revision), "eventId": event["id"], "figures": figures}
		state["status"] = "publication_ready"
	case "pause":
		if isOneOf(status, "paused", "failed") {
			return errors.New("Already paused or failed")
		}
		state["resumeStatus"], state["status"] = status, "paused"
	case "resume":
		if status != "paused" {
			return errors.New("Not paused")
		}
		state["status"] = state["resumeStatus"]
		delete(state, "resumeStatus")
	case "fail":
		if !isOneOf(status, "waiting_ai", "waiting_route", "waiting_figure") || !text(event["error"]) {
			return errors.New("Failure must reference pending AI work")
		}
		if intValue(event["revision"]) != revision || !reflect.DeepEqual(event["stage"], state["stage"]) {
			return errors.New("Stale failure")
		}
		state["resumeStatus"], state["status"], state["error"] = status, "failed", event["error"]
	case "retry":
		if status != "failed" {
			return errors.New("Retry requires failure")
		}
		state["status"] = state["resumeStatus"]
		delete(state, "resumeStatus")
		delete(state, "error")
	default:
		if rules.figures != nil {
			if handled, err := rules.figures.Transition(state, event); handled || err != nil {
				return err
			}
		}
		return fmt.Errorf("Unsupported event: %s", kind)
	}
	return nil
}

func complete(state, event object) error {
	stage := str(event["stage"])
	revision := intValue(state["revision"])
	if state["status"] != "waiting_ai" || stage != state["stage"] || intValue(event["revision"]) != revision {
		return errors.New("Unexpected or stale AI result")
	}
	output := obj(event["output"])
	marked := stage == "draft" && marksChanges(state)
	if marked {
		if event["mode"] != "edit" {
			return errors.New("Unexpected or stale draft edit")
		}
		var err error
		output, err = acceptEdits(state, output)
		if err != nil || output == nil {
			return err
		}
	}
	if err := validateOutput(stage, output); err != nil {
		return err
	}
	switch stage {
	case "outline":
		if !acceptOutline(state, output) {
			return nil
		}
	case "draft":
		if !marked {
			section := currentSection(state)
			if section != nil && intValue(event["section"]) != intValue(section["index"]) {
				return errors.New("Unexpected or stale draft section")
			}
			output = acceptDraft(state, output, section)
			if output == nil {
				return nil
			}
		}
	}
	obj(state["artifacts"])[stage] = object{"revision": num(revision), "output": output}
	if stage == "diagnose" {
		if !slices.ContainsFunc(array(state["requirementLog"]), func(entry any) bool { return obj(entry)["source"] == "idea" }) {
			recordChanges(state, "idea", output["requirementChanges"])
		}
	}
	if index := slices.Index(stages, stage); index < len(stages)-1 {
		ai(state, stages[index+1])
		return nil
	}
	return presentOrCorrect(state)
}

func latestHistory(state object) object {
	history := array(state["history"])
	if len(history) == 0 {
		return nil
	}
	return obj(history[len(history)-1])
}

func beginRevision(state object, feedback, source string) {
	history := object{
		"plan": completePlan(), "revision": state["revision"], "artifacts": state["artifacts"],
		"feedback": feedback, "feedbackSource": source,
	}
	if figure := state["figure"]; figure != nil {
		history["figure"] = figure
	}
	state["history"] = append(array(state["history"]), history)
	delete(state, "figure")
	state["revision"] = num(intValue(state["revision"]) + 1)
	state["feedback"], state["feedbackSource"] = feedback, source
	if source == "person" {
		delete(state, "brief")
	}
	state["approval"], state["satisfiedRevision"] = nil, nil
	delete(state, "unmet")
}

func startBrief(state object) error {
	brief := obj(state["brief"])
	recordChanges(state, "feedback", brief["requirementChanges"])
	return routeTo(state, str(brief["target"]), brief["intent"])
}

func routeTo(state object, target string, reason any) error {
	index := slices.Index(stages, target)
	if index < 0 || artifactsIssue(state["artifacts"], stages[:index], intValue(state["revision"])-1) != "" {
		return errors.New("Requirements contract incomplete for route prerequisites")
	}
	artifacts := object{}
	for _, stage := range stages[:index] {
		before := obj(obj(state["artifacts"])[stage])
		after := object{}
		for key, value := range before {
			after[key] = value
		}
		after["revision"], after["reusedFromRevision"] = state["revision"], before["revision"]
		artifacts[stage] = after
	}
	state["artifacts"], state["plan"] = artifacts, completePlan()
	state["routeTarget"], state["routeReason"] = target, reason
	ai(state, target)
	return nil
}

func presentOrCorrect(state object) error {
	unmet := unmetRequirements(state)
	review := obj(obj(obj(state["artifacts"])["review"])["output"])
	if review["verdict"] == "revise" {
		target := str(review["reviseFrom"])
		if !isOneOf(target, "outline", "draft") {
			target = "draft"
		}
		criteria := array(review["unmetCriteria"])
		if !textList(criteria, 1) {
			criteria = array(review["findings"])
		}
		items := make([]string, len(criteria))
		for i, item := range criteria {
			items[i] = str(item)
		}
		unmet = append(unmet, object{"kind": "review", "target": target, "message": "검토 판정 미충족: " + strings.Join(items, " / ")})
	}
	attempts := max(0, intValue(state["autoCorrections"]))
	if len(unmet) > 0 && attempts < 2 {
		target := str(obj(unmet[0])["target"])
		messages := make([]string, len(unmet))
		for i, item := range unmet {
			if stage := str(obj(item)["target"]); slices.Index(stages, stage) < slices.Index(stages, target) {
				target = stage
			}
			messages[i] = str(obj(item)["message"])
		}
		message := strings.Join(messages, "\n")
		beginRevision(state, message, "auto")
		state["autoCorrections"] = num(attempts + 1)
		return routeTo(state, target, message)
	}
	state["status"] = "awaiting_user"
	if len(unmet) > 0 {
		state["unmet"] = unmet
	}
	return nil
}
