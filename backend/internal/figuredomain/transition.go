package figuredomain

import (
	"errors"
	"slices"
)

func (rules *Rules) Transition(state, event object) (bool, error) {
	kind := str(event["type"])
	if kind != "figure_result" && !rules.UserEvent(kind) {
		return false, nil
	}
	return true, apply(state, event, kind)
}

func apply(state, event object, kind string) error {
	figure := obj(state["figure"])
	status := str(state["status"])
	reviewed := count(event["reviewedRevision"]) == count(state["revision"])
	selected, prepared := ids(figure["selected"]), itemIDs(figure["items"])
	switch kind {
	case "request_figures":
		if status != "satisfied" || figure != nil || !reviewed {
			return errors.New("Figures require the current confirmed draft without figure work")
		}
		planned := object{"phase": "propose", "revision": state["revision"]}
		if note := str(event["note"]); note != "" {
			planned["note"] = note
		}
		state["figure"], state["status"] = planned, waiting
	case "figure_result":
		return result(state, event, figure)
	case "place_figure", "remove_figure":
		if status != choice || !reviewed {
			return errors.New("시각자료 위치 선택 대기 중에만 자리를 바꿀 수 있습니다.")
		}
		draft := draftText(state)
		candidates, err := editPlacement(kind, draft, figure["candidates"], event)
		if err != nil {
			return err
		}
		figure["candidates"] = candidates
		figure["coverage"] = coverage(draft, candidates, list(figure["skipped"]))
	case "select_figures":
		pool, chosen := itemIDs(figure["candidates"]), ids(event["figures"])
		if status != choice || !reviewed || !subset(chosen, pool) {
			return errors.New("Figure selection requires current candidates")
		}
		selected := ordered(chosen, pool)
		next := omit(figure, "world", "style", "motifs", "look")
		copyPresent(next, event, "look")
		candidates := filterItems(figure["candidates"], pool)
		for i, candidate := range candidates {
			id := str(candidate["id"])
			next := omit(candidate, "look", "lookBy", "direction", "route")
			if slices.Contains(selected, id) {
				if dir := trimmed(obj(event["directions"])[id]); dir != "" {
					next["direction"] = dir
				}
				if route := str(obj(event["routes"])[id]); route != "" {
					next["route"] = route
				}
			}
			candidates[i] = next
		}
		next["phase"], next["candidates"], next["selected"] = "compose", candidates, selected
		state["figure"], state["status"] = next, waiting
	case "approve_design":
		if status != design || !reviewed {
			return errors.New("Design approval requires the current design")
		}
		pending := pendingIDs(figure, figure["items"])
		if len(pending) == 0 {
			return errors.New("No figure left to generate")
		}
		if directions := obj(event["directions"]); directions != nil {
			candidates := filterItems(figure["candidates"], itemIDs(figure["candidates"]))
			for i, candidate := range candidates {
				next := omit(candidate, "direction")
				id := str(candidate["id"])
				if direction := trimmed(directions[id]); direction != "" && slices.Contains(selected, id) {
					next["direction"] = direction
				}
				candidates[i] = next
			}
			figure["candidates"] = candidates
		}
		figure["phase"], figure["current"], state["status"] = "generate", batch(pending, drawPass), waiting
	case "revise_design":
		targets := selected
		if event["figures"] != nil {
			targets = ids(event["figures"])
		}
		if status != design || !reviewed || !revisionReady(event) || !subset(targets, selected) {
			return errors.New("Design revision requires feedback on selected figures")
		}
		state["figure"], state["status"] = recompose(figure, event, targets), waiting
	case "revise_figures":
		targets := ids(event["figures"])
		target := str(event["target"])
		if status != review || !reviewed || !revisionReady(event) ||
			(target != "compose" && target != fixPass) || !subset(targets, prepared) {
			return errors.New("Figure revision requires feedback on prepared figures")
		}
		targeted := targets[0]
		candidates := indexItems(figure["candidates"])
		fixes := count(candidates[targeted]["fixes"])
		if target == fixPass && (len(targets) != 1 || fixes >= 3) {
			return errors.New("Figure fix takes one figure within the fix limit")
		}
		items := withoutItems(figure["items"], targets)
		if target == "compose" {
			next := recompose(figure, event, ordered(targets, selected))
			next["items"] = items
			state["figure"] = next
		} else {
			candidates[targeted]["fix"], candidates[targeted]["fixes"] = trimmed(event["feedback"]), fixes+1
			figure["passDrafts"] = object{targeted: indexItems(figure["items"])[targeted]}
			figure["items"], figure["phase"], figure["current"] = items, "generate", batch(targets, fixPass)
		}
		state["status"] = waiting
	case "retry_figures":
		failed := obj(figure["failed"])
		targets := ids(event["figures"])
		if status != review || !reviewed || !subset(targets, keys(failed)) {
			return errors.New("Figure retry requires failed figures")
		}
		next := omit(figure, progressKeys...)
		setFailures(next, omit(failed, targets...))
		next["phase"], next["current"] = "generate", batch(ordered(targets, selected), drawPass)
		state["figure"], state["status"] = next, waiting
	case "confirm_figures":
		keep := prepared
		if event["figures"] != nil {
			keep = ids(event["figures"])
		}
		if status != review || !reviewed || !subset(keep, prepared) {
			return errors.New("Figure confirmation requires current prepared figures")
		}
		delete(figure, "failed")
		figure["phase"], figure["items"], figure["confirmedEventId"] = "confirmed", filterItems(figure["items"], keep), event["id"]
		state["status"] = "satisfied"
	case "discard_figures":
		if figure == nil || !reviewed || !slices.Contains([]string{choice, design, review, "satisfied"}, status) {
			return errors.New("No figure work to discard")
		}
		delete(state, "figure")
		state["status"] = "satisfied"
	}
	return nil
}

func batch(ids []string, pass string) object {
	return object{"ids": ids, "pass": pass}
}

func setFailures(figure, failed object) {
	if len(failed) == 0 {
		delete(figure, "failed")
	} else {
		figure["failed"] = failed
	}
}

func withoutItems(items any, targets []string) []object {
	result := []object{}
	for _, value := range list(items) {
		if item := obj(value); !slices.Contains(targets, str(item["id"])) {
			result = append(result, item)
		}
	}
	return result
}

func revisionReady(event object) bool {
	feedback := trimmed(event["feedback"]) != "" && units(str(event["feedback"])) <= 600
	look := str(event["look"]) != ""
	if event["target"] == fixPass {
		return feedback && !look
	}
	return feedback || look
}

func recompose(figure, event object, targets []string) object {
	result := omit(figure, progressKeys...)
	delete(result, "recompose")
	result["phase"] = "compose"
	if len(targets) != len(ids(figure["selected"])) {
		result["recompose"] = targets
	}
	if text := trimmed(event["feedback"]); text != "" {
		result["feedback"] = text
	}
	if look := str(event["look"]); look != "" {
		candidates := filterItems(figure["candidates"], itemIDs(figure["candidates"]))
		for i, candidate := range candidates {
			if slices.Contains(targets, str(candidate["id"])) {
				next := omit(candidate)
				next["look"], next["lookBy"] = look, "user"
				candidates[i] = next
			}
		}
		result["candidates"] = candidates
	}
	return result
}
