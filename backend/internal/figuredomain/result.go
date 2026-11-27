package figuredomain

import (
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
)

var figureID = regexp.MustCompile(`^f[1-9][0-9]?$`)

func result(state, event, figure object) error {
	stage := str(event["stage"])
	batchIDs, pass := current(figure)
	if state["status"] != waiting || count(event["revision"]) != count(state["revision"]) ||
		stage != workStage(figure) || (stage == "figure" && !matchesBatch(event, batchIDs, pass)) {
		return errors.New("Unexpected or stale figure result")
	}
	out := obj(event["output"])
	switch stage {
	case "figure_plan":
		candidates, err := acceptCandidates(draftText(state), list(out["candidates"]))
		if err != nil {
			return err
		}
		skipped := acceptSkipped(out["skipped"])
		figure["phase"], figure["candidates"], figure["skipped"] = "choose", candidates, skipped
		figure["coverage"] = coverage(draftText(state), candidates, skipped)
		state["status"] = choice
	case "figure_compose":
		if err := acceptDesigns(figure, out); err != nil {
			return err
		}
		figure["phase"], state["status"] = "design", design
	case "figure":
		return advance(state, figure, event, out, batchIDs)
	default:
		return errors.New("Unknown figure stage")
	}
	return nil
}

func matchesBatch(event object, expected []string, pass string) bool {
	actualPass := str(event["pass"])
	if event["pass"] == nil {
		actualPass = drawPass
	}
	if actualPass != pass {
		return false
	}
	if raw := event["figureIds"]; raw != nil {
		actual := ids(raw)
		return len(actual) == len(expected) && subset(actual, expected)
	}
	if id := str(event["figureId"]); id != "" {
		return len(expected) == 1 && expected[0] == id
	}
	return true // Legacy results are checked against their exact output IDs.
}

func acceptCandidates(body string, rows []any) ([]object, error) {
	if len(rows) == 0 {
		return nil, errors.New("Figure plan requires candidates")
	}
	seen := map[string]bool{}
	candidates := []object{}
	for _, item := range rows {
		row := obj(item)
		if !bounded(row["anchor"], 400) || !bounded(row["claim"], 300) || !bounded(row["reason"], 500) {
			return nil, errors.New("Invalid figure candidate")
		}
		anchor := trimmed(row["anchor"])
		if seen[anchor] || !strings.Contains(body, anchor) || len(candidates) == maxCandidates {
			continue
		}
		seen[anchor] = true
		candidate := object{"id": fmt.Sprintf("f%d", len(candidates)+1), "anchor": anchor, "claim": trimmed(row["claim"]), "reason": trimmed(row["reason"])}
		if kind := str(row["kind"]); kind != "" && units(kind) <= 40 {
			candidate["kind"] = kind
		}
		if bounded(row["without"], 200) {
			candidate["without"] = trimmed(row["without"])
		}
		candidates = append(candidates, candidate)
	}
	if len(candidates) == 0 {
		return nil, errors.New("No figure anchor matches the confirmed draft")
	}
	return candidates, nil
}

func acceptSkipped(value any) []any {
	rows := list(value)
	for _, item := range rows {
		row := obj(item)
		unit, isText := row["unit"].(string)
		if !isText || units(unit) > 200 || !bounded(row["reason"], 200) {
			return []any{}
		}
	}
	if rows == nil {
		return []any{}
	}
	return rows
}

func acceptDesigns(figure, out object) error {
	rows := list(out["designs"])
	if len(rows) == 0 {
		return errors.New("Figure composition requires designs")
	}
	byID := map[string]object{}
	for _, item := range rows {
		row := obj(item)
		id := str(row["id"])
		if !figureID.MatchString(id) || !bounded(row["scene"], 500) {
			return errors.New("Invalid figure design")
		}
		byID[id] = row
	}
	selected := ids(figure["selected"])
	targets := selected
	partial := figure["recompose"] != nil
	if partial {
		targets = ids(figure["recompose"])
	}
	for _, id := range targets {
		if byID[id] == nil {
			return fmt.Errorf("Missing design for selected figure: %s", id)
		}
	}
	candidates := filterItems(figure["candidates"], itemIDs(figure["candidates"]))
	for i, candidate := range candidates {
		id := str(candidate["id"])
		if !slices.Contains(targets, id) {
			continue
		}
		candidates[i] = acceptDesign(candidate, byID[id])
	}
	if partial {
		motifs := motifNames(figure["motifs"])
		for _, candidate := range filterItems(candidates, targets) {
			if candidate["motifs"] != nil {
				candidate["motifs"] = matchingMotifs(ids(candidate["motifs"]), motifs, false)
			}
		}
	} else {
		applyConsistency(figure, out, filterItems(candidates, selected))
	}
	delete(figure, "recompose")
	delete(figure, "feedback")
	figure["candidates"] = candidates
	return nil
}

func acceptDesign(candidate, row object) object {
	next := withoutDesign(candidate)
	next["scene"] = trimmed(row["scene"])
	if look := str(row["look"]); next["look"] == nil && validLook(look) {
		next["look"] = look
	}
	if bounded(row["analogy"], 80) {
		next["analogy"] = trimmed(row["analogy"])
	}
	if mapping := acceptMapping(row["mapping"]); len(mapping) > 0 {
		next["mapping"] = mapping
	}
	if motifs := list(row["motifs"]); motifs != nil {
		if !slices.ContainsFunc(motifs, func(v any) bool { _, ok := v.(string); return !ok || units(str(v)) > 40 }) {
			next["motifs"] = motifs
		}
	}
	return next
}

func acceptMapping(value any) []object {
	mapping := list(value)
	if len(mapping) > 12 {
		return nil
	}
	result := []object{}
	for _, row := range mapping {
		m := obj(row)
		if !bounded(m["element"], 80) || !bounded(m["concept"], 80) {
			return nil
		}
		result = append(result, object{"element": trimmed(m["element"]), "concept": trimmed(m["concept"])})
	}
	return result
}

func validLook(look string) bool {
	return slices.Contains([]string{"anatomy", "sketchnote", "tablet", "stick", "manual"}, look)
}

func motifNames(value any) []string {
	names := []string{}
	for _, item := range list(value) {
		names = append(names, trimmed(obj(item)["name"]))
	}
	return names
}

func matchingMotifs(refs, declared []string, unique bool) []string {
	names := []string{}
	for _, raw := range refs {
		name := strings.TrimSpace(raw)
		if slices.Contains(declared, name) && (!unique || !slices.Contains(names, name)) {
			names = append(names, name)
		}
	}
	return names
}

func applyConsistency(figure, out object, selected []object) {
	delete(figure, "style")
	delete(figure, "world")
	if world := out["world"]; bounded(world, 300) {
		figure["world"] = trimmed(world)
	}
	style := acceptStyle(obj(out["style"]))
	if look := str(figure["look"]); look != "" {
		if style == nil {
			style = object{}
		}
		style["look"] = look
	}
	if style != nil {
		figure["style"] = style
	}
	declared := acceptMotifs(out["motifs"])
	names := motifNames(declared)
	references := map[string]int{}
	for _, item := range selected {
		refs := matchingMotifs(ids(item["motifs"]), names, true)
		if len(refs) == 0 {
			delete(item, "motifs")
			continue
		}
		item["motifs"] = refs
		for _, name := range refs {
			references[name]++
		}
	}
	shared := []object{}
	for _, motif := range declared {
		if references[str(motif["name"])] >= 2 {
			shared = append(shared, motif)
		}
	}
	figure["motifs"] = shared
}

func acceptStyle(style object) object {
	out := object{}
	for _, key := range []string{"accent", "base", "labels"} {
		if !bounded(style[key], 200) {
			return nil
		}
		out[key] = trimmed(style[key])
	}
	if look := str(style["look"]); validLook(look) {
		out["look"] = look
	}
	return out
}

func acceptMotifs(value any) []object {
	motifs := []object{}
	seen := map[string]bool{}
	for _, item := range list(value) {
		row := obj(item)
		if !bounded(row["name"], 40) || !bounded(row["look"], 300) {
			return nil
		}
		name := trimmed(row["name"])
		if !seen[name] && len(motifs) < 12 {
			seen[name] = true
			motifs = append(motifs, object{"name": name, "look": trimmed(row["look"])})
		}
	}
	return motifs
}

func advance(state, figure, event, out object, batchIDs []string) error {
	previousFailures := omit(obj(figure["failed"]))
	failed := []string{}
	for _, raw := range list(event["failed"]) {
		row := obj(raw)
		id := str(row["id"])
		if !slices.Contains(batchIDs, id) || slices.Contains(failed, id) {
			return errors.New("Figure failures must be part of the batch and leave at least one figure")
		}
		failed = append(failed, id)
		msg := truncate(str(row["error"]), 200)
		if msg == "" {
			msg = "실패"
		}
		previousFailures[id] = msg
	}
	if len(failed) >= len(batchIDs) {
		return errors.New("Figure failures must be part of the batch and leave at least one figure")
	}
	candidates := indexItems(figure["candidates"])
	made := indexItems(figure["items"])
	accepted := map[string]object{}
	for _, raw := range list(out["figures"]) {
		row := obj(raw)
		id := str(row["id"])
		if !slices.Contains(batchIDs, id) || slices.Contains(failed, id) || accepted[id] != nil {
			return errors.New("Figure result does not match the current batch")
		}
		item, err := acceptFigure(candidates[id], row)
		if err != nil {
			return err
		}
		accepted[id] = item
	}
	for _, id := range batchIDs {
		if slices.Contains(failed, id) {
			continue
		}
		if accepted[id] == nil {
			return fmt.Errorf("Missing figure for selected candidate: %s", id)
		}
		delete(previousFailures, id)
		made[id] = accepted[id]
	}
	items := []object{}
	for _, id := range ids(figure["selected"]) {
		if item := made[id]; item != nil {
			items = append(items, item)
		}
	}
	next := omit(figure, progressKeys...)
	setFailures(next, previousFailures)
	next["items"] = items
	pending := without(pendingIDs(figure, items), keys(previousFailures))
	if len(pending) > 0 {
		next["current"] = batch(pending, drawPass)
	} else {
		next["phase"], state["status"] = "review", review
	}
	state["figure"] = next
	return nil
}

func without(values, excluded []string) []string {
	out := []string{}
	for _, value := range values {
		if !slices.Contains(excluded, value) {
			out = append(out, value)
		}
	}
	return out
}

func acceptFigure(candidate, row object) (object, error) {
	svg, err := NormalizeSVG(str(row["svg"]))
	if err != nil {
		return nil, err
	}
	if !bounded(row["alt"], 300) {
		return nil, errors.New("Invalid figure alternative text")
	}
	item := object{"id": row["id"], "anchor": candidate["anchor"], "claim": candidate["claim"], "svg": svg, "alt": trimmed(row["alt"])}
	if source := str(row["source"]); source != "" && units(source) <= 200000 {
		item["source"] = source
	}
	if bounded(row["caption"], 200) {
		item["caption"] = trimmed(row["caption"])
	}
	return item, nil
}
