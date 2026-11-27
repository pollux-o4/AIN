package figuredomain

import (
	"slices"
	"strings"
)

func (*Rules) Action(state object) (object, bool) {
	if state["status"] != waiting {
		return nil, false
	}
	figure := obj(state["figure"])
	action := object{"type": "request_figure", "stage": workStage(figure), "revision": state["revision"]}
	if note := str(figure["note"]); note != "" {
		action["note"] = note
	}
	switch figure["phase"] {
	case "compose":
		composeAction(action, figure)
	case "generate":
		drawAction(action, figure)
	default:
		action["units"] = figureUnits(draftText(state))
	}
	return action, true
}

func withoutDesign(candidate object) object {
	result := omit(candidate, "analogy", "scene", "mapping", "motifs")
	if candidate["lookBy"] != "user" {
		delete(result, "look")
	}
	return result
}

func composeAction(action, figure object) {
	selected := ids(figure["selected"])
	targets := selected
	if recompose := figure["recompose"]; recompose != nil {
		targets = ids(recompose)
		action["recompose"] = recompose
		copyPresent(action, figure, "world", "style", "motifs")
		if len(list(action["motifs"])) == 0 {
			delete(action, "motifs")
		}
	}
	copyPresent(action, figure, "feedback", "look")
	candidates := filterItems(figure["candidates"], selected)
	for i, candidate := range candidates {
		if slices.Contains(targets, str(candidate["id"])) {
			candidates[i] = withoutDesign(candidate)
		}
	}
	action["candidates"] = candidates
}

func drawAction(action, figure object) {
	batch, pass := current(figure)
	action["figureIds"], action["pass"] = batch, pass
	copyPresent(action, figure, "world")
	previous, selected := drafts(figure), ids(figure["selected"])
	parts := make([]object, 0, len(batch))
	for _, id := range batch {
		candidate := filterItems(figure["candidates"], []string{id})
		part := object{
			"figureId": id, "progress": object{"index": slices.Index(selected, id) + 1, "total": len(selected)},
			"candidates": candidate,
		}
		if len(candidate) == 1 {
			addConsistency(part, figure, candidate[0])
		}
		if old := previous[id]; old != nil {
			part["previous"] = []any{old}
		}
		parts = append(parts, part)
	}
	action["parts"] = parts
}

func copyPresent(target, source object, names ...string) {
	for _, key := range names {
		if value := source[key]; value != nil && value != "" {
			target[key] = value
		}
	}
}

func addConsistency(action, figure, candidate object) {
	names := ids(candidate["motifs"])
	var motifs []any
	for _, raw := range list(figure["motifs"]) {
		if slices.Contains(names, str(obj(raw)["name"])) {
			motifs = append(motifs, raw)
		}
	}
	if len(motifs) > 0 {
		action["motifs"] = motifs
	}
	style := obj(figure["style"])
	look := str(candidate["look"])
	if look != "" {
		style = omit(style)
		style["look"] = look
	}
	if style != nil {
		action["style"] = style
	}
}

const leadUnit = "도입부"

func figureUnits(text string) []string {
	result := []string{leadUnit}
	fenced := false
	for _, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(line, "```") {
			fenced = !fenced
		}
		if fenced {
			continue
		}
		if title := headingTitle(line); title != "" {
			if title == "한눈에 정리" && strings.TrimSpace(line) == "## 한눈에 정리" {
				break
			}
			result = append(result, title)
		}
	}
	return result
}

func headingTitle(line string) string {
	tail := strings.TrimLeft(line, "#")
	if len(line)-len(tail) < 2 || len(tail) == 0 || !strings.ContainsRune(" \t\r", rune(tail[0])) {
		return ""
	}
	return strings.TrimSpace(tail)
}

func anchorSection(text, anchor string) string {
	at := strings.Index(text, anchor)
	if at < 0 {
		return leadUnit
	}
	title := leadUnit
	for _, line := range strings.Split(text[:at], "\n") {
		if header := headingTitle(line); header != "" {
			title = header
		}
	}
	return title
}

func coverage(text string, candidates []object, skipped []any) object {
	units := figureUnits(text)
	got, omitted := map[string]bool{}, map[string]bool{}
	for _, candidate := range candidates {
		got[anchorSection(text, str(candidate["anchor"]))] = true
	}
	for _, item := range skipped {
		omitted[trimmed(obj(item)["unit"])] = true
	}
	missing := []string{}
	withFigure, ignored := 0, 0
	for _, unit := range units {
		switch {
		case got[unit]:
			withFigure++
		case omitted[unit]:
			ignored++
		default:
			missing = append(missing, unit)
		}
	}
	return object{"units": len(units), "withFigure": withFigure, "skipped": ignored, "missing": missing, "candidates": len(candidates)}
}
