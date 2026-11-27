package figuredomain

import "strings"

// PublicView exposes figures without embedding SVG or workspace files.
func PublicView(figure map[string]any, revision int64) map[string]any {
	if figure == nil || int64(count(figure["revision"])) != revision {
		return nil
	}
	phase := str(figure["phase"])
	candidates := []object{}
	for _, raw := range list(figure["candidates"]) {
		row := obj(raw)
		candidate := publicFields(row, "id", "anchor", "claim", "origin", "reason", "analogy",
			"scene", "kind", "motifs", "without", "mapping", "route", "direction", "lookBy")
		candidate["section"] = nil
		candidate["routeBy"] = "default"
		if str(row["route"]) != "" {
			candidate["routeBy"] = "user"
		}
		candidates = append(candidates, candidate)
	}
	items := []object{}
	for _, raw := range list(figure["items"]) {
		row := obj(raw)
		item := publicFields(row, "id", "anchor", "claim", "look", "alt", "caption", "route", "labels")
		item["mime"] = "image/svg+xml"
		svg := strings.ToLower(str(row["svg"]))
		item["motion"] = strings.Contains(svg, "<animate") || strings.Contains(svg, "@keyframes") || strings.Contains(svg, "<set ")
		items = append(items, item)
	}
	result := publicFields(figure, "phase", "note", "world", "feedback", "recompose", "style", "motifs", "failed", "coverage")
	result["routesAvailable"], result["candidates"], result["items"] = []string{"svg"}, candidates, items
	result["selected"] = ids(figure["selected"])
	if result["selected"] == nil {
		result["selected"] = []string{}
	}
	if cov := obj(result["coverage"]); cov != nil {
		clone := omit(cov)
		clone["gap"] = nil
		result["coverage"] = clone
	}
	if phase == "generate" {
		ids, pass := current(figure)
		result["current"] = object{"ids": ids, "pass": pass}
	}
	return result
}

func publicFields(from object, keys ...string) object {
	result := object{}
	for _, key := range keys {
		if value, ok := from[key]; ok {
			result[key] = value
		}
	}
	return result
}
