package figuredomain

import (
	"fmt"
	"regexp"
	"strings"
)

var animatedSVG = regexp.MustCompile(`(?i)<(?:animate|animateTransform|animateMotion|set)\b|@keyframes|animation\s*:`)

// PublicView exposes figures without embedding SVG or workspace files.
func PublicView(figure map[string]any, revision int64, draft string, route func(kind, choice string) string) map[string]any {
	if figure == nil || int64(count(figure["revision"])) != revision {
		return nil
	}
	candidates := []object{}
	looks := map[string]any{}
	for _, raw := range list(figure["candidates"]) {
		row := obj(raw)
		candidate := optionalFields(row, "reason", "analogy", "scene", "kind", "without", "direction")
		candidate["id"], candidate["anchor"], candidate["claim"] = row["id"], row["anchor"], row["claim"]
		candidate["origin"] = coalesce(row["origin"], "ai")
		candidate["quote"], _ = projection(str(row["anchor"]))
		candidate["section"] = publicSection(draft, str(row["anchor"]))
		candidate["motifs"], candidate["mapping"] = publicList(row["motifs"]), publicList(row["mapping"])
		candidate["route"] = route(str(row["kind"]), str(row["route"]))
		candidate["routeBy"] = "default"
		if str(row["route"]) != "" {
			candidate["routeBy"] = "user"
		}
		candidate["look"] = coalesce(row["look"], obj(figure["style"])["look"])
		candidate["lookBy"] = "auto"
		if row["lookBy"] == "user" {
			candidate["lookBy"] = "user"
		}
		looks[str(row["id"])] = candidate["look"]
		candidates = append(candidates, candidate)
	}
	items := []object{}
	for _, raw := range list(figure["items"]) {
		row := obj(raw)
		item := optionalFields(row, "id", "anchor", "claim", "alt", "caption")
		item["look"] = coalesce(looks[str(row["id"])], obj(figure["style"])["look"])
		item["mime"], item["route"] = "image/svg+xml", "svg"
		item["motion"] = animatedSVG.MatchString(str(row["svg"]))
		item["labels"] = []any{}
		items = append(items, item)
	}
	result := optionalFields(figure, "phase", "note", "world", "feedback", "style")
	result["routesAvailable"], result["candidates"], result["items"] = []string{"svg"}, candidates, items
	result["selected"], result["motifs"], result["recompose"] = publicList(figure["selected"]), publicList(figure["motifs"]), publicList(figure["recompose"])
	result["failed"], result["coverage"], result["current"] = coalesce(figure["failed"], object{}), nil, nil
	if cov := obj(figure["coverage"]); cov != nil {
		clone := omit(cov)
		clone["gap"] = publicCoverageGap(cov)
		result["coverage"] = clone
	}
	if figure["phase"] == "generate" {
		result["current"] = PublicProgress(figure)
	}
	return result
}

func publicCoverageGap(value object) any {
	if missing := len(list(value["missing"])); missing > 0 {
		return fmt.Sprintf("검토하지 않은 단위 %d곳", missing)
	}
	if units, candidates := count(value["units"]), count(value["candidates"]); units >= 3 && candidates <= 1 {
		return fmt.Sprintf("단위 %d곳 중 후보 %d개", units, candidates)
	}
	return nil
}

func optionalFields(from object, keys ...string) object {
	result := object{}
	for _, key := range keys {
		result[key] = from[key]
	}
	return result
}

func publicList(raw any) []any {
	if result := list(raw); result != nil {
		return result
	}
	return []any{}
}

func coalesce(value, fallback any) any {
	if value != nil {
		return value
	}
	return fallback
}

func publicSection(draft, anchor string) any {
	at := strings.Index(draft, anchor)
	if at < 0 || anchor == "" {
		return nil
	}
	var title string
	for line := range strings.SplitSeq(draft[:at], "\n") {
		if section := headingTitle(line); section != "" {
			title = section
		}
	}
	if title == "" {
		return nil
	}
	return title
}

type FigureProgress struct {
	IDs  []string `json:"ids"`
	Pass string   `json:"pass"`
}

func PublicProgress(figure map[string]any) FigureProgress {
	batch, pass := current(figure)
	return FigureProgress{IDs: batch, Pass: pass}
}
