// Package figuredomain implements the FIGURE-001 editorial branch.
package figuredomain

import (
	"math"
	"slices"
	"strings"

	"github.com/pollux-o4/AIN/backend/internal/writing"
)

type object = map[string]any

const (
	waiting       = "waiting_figure"
	choice        = "awaiting_figure_choice"
	design        = "awaiting_figure_design"
	review        = "awaiting_figure_review"
	maxCandidates = 30
	drawPass      = "draw"
	fixPass       = "fix"
)

var phases = map[string][]string{
	"propose": {waiting}, "compose": {waiting}, "generate": {waiting},
	"choose": {choice}, "design": {design}, "review": {review}, "confirmed": {"satisfied", "publication_ready"},
}

var userEvents = []string{
	"request_figures", "select_figures", "place_figure", "remove_figure", "approve_design", "revise_design",
	"revise_figures", "retry_figures", "confirm_figures", "discard_figures",
}

var progressKeys = []string{"current", "draft", "pass", "drafts", "passDrafts"}

type Rules struct{}

func New() *Rules { return &Rules{} }

var _ writing.FigureRules = (*Rules)(nil)

func (*Rules) UserEvent(kind string) bool { return slices.Contains(userEvents, kind) }

func obj(value any) object {
	m, _ := value.(map[string]any)
	return m
}

func list(value any) []any {
	switch values := value.(type) {
	case []any:
		return values
	case []string:
		result := make([]any, len(values))
		for i, item := range values {
			result[i] = item
		}
		return result
	case []object:
		result := make([]any, len(values))
		for i, item := range values {
			result[i] = item
		}
		return result
	default:
		return nil
	}
}

func str(value any) string {
	s, _ := value.(string)
	return s
}

func trimmed(value any) string { return strings.TrimSpace(str(value)) }

func count(value any) int {
	if n, ok := value.(float64); ok {
		if math.Trunc(n) != n || math.Abs(n) > 1<<53-1 {
			return -1
		}
		return int(n)
	}
	n, _ := value.(int)
	return n
}

func ids(value any) []string {
	strings := make([]string, 0, len(list(value)))
	for _, item := range list(value) {
		strings = append(strings, str(item))
	}
	return strings
}

func itemIDs(value any) []string {
	strings := make([]string, 0, len(list(value)))
	for _, item := range list(value) {
		strings = append(strings, str(obj(item)["id"]))
	}
	return strings
}

func subset(chosen, pool []string) bool {
	seen := map[string]bool{}
	for _, id := range chosen {
		if id == "" || seen[id] || !slices.Contains(pool, id) {
			return false
		}
		seen[id] = true
	}
	return len(chosen) > 0
}

func ordered(chosen, pool []string) []string {
	result := []string{}
	for _, id := range pool {
		if slices.Contains(chosen, id) {
			result = append(result, id)
		}
	}
	return result
}

func omit(source object, keys ...string) object {
	result := object{}
	for key, value := range source {
		if !slices.Contains(keys, key) {
			result[key] = value
		}
	}
	return result
}

func indexItems(value any) map[string]object {
	index := map[string]object{}
	for _, raw := range list(value) {
		item := obj(raw)
		id := str(item["id"])
		if _, exists := index[id]; !exists {
			index[id] = item
		}
	}
	return index
}

func filterItems(items any, keep []string) []object {
	result := []object{}
	for _, raw := range list(items) {
		item := obj(raw)
		if slices.Contains(keep, str(item["id"])) {
			result = append(result, item)
		}
	}
	return result
}

func keys(m object) []string {
	result := make([]string, 0, len(m))
	for key := range m {
		result = append(result, key)
	}
	return result
}

func draftText(state object) string {
	return str(obj(obj(obj(state["artifacts"])["draft"])["output"])["text"])
}

func pendingIDs(figure object, items any) []string {
	done := itemIDs(items)
	next := []string{}
	for _, id := range ids(figure["selected"]) {
		if !slices.Contains(done, id) {
			next = append(next, id)
		}
	}
	return next
}

func current(figure object) ([]string, string) {
	cur := obj(figure["current"])
	if cur == nil {
		return pendingIDs(figure, figure["items"]), drawPass
	}
	batch := ids(cur["ids"])
	if cur["ids"] == nil {
		batch = []string{str(cur["id"])}
	}
	return batch, str(cur["pass"])
}

func drafts(figure object) object {
	if m := obj(figure["passDrafts"]); m != nil {
		return m
	}
	if m := obj(figure["draft"]); m != nil {
		return object{str(m["id"]): m}
	}
	return object{}
}

func workStage(figure object) string {
	switch figure["phase"] {
	case "compose":
		return "figure_compose"
	case "generate":
		return "figure"
	default:
		return "figure_plan"
	}
}

func (*Rules) Issue(state object, status string) string {
	raw, present := state["figure"]
	if !present {
		if slices.Contains([]string{waiting, choice, design, review}, status) {
			return "Figure status requires figure work"
		}
		return ""
	}
	figure := obj(raw)
	if figure == nil {
		return "Invalid figure work"
	}
	phase := str(figure["phase"])
	if !slices.Contains(phases[phase], status) {
		return "Figure phase does not match status"
	}
	if count(figure["revision"]) != count(state["revision"]) {
		return "Figure work must reference current revision"
	}
	if phase == "propose" {
		return ""
	}
	candidates := list(figure["candidates"])
	text := draftText(state)
	if candidates == nil || len(candidates) > maxCandidates || (len(candidates) == 0 && phase != "choose") {
		return "Figure candidates must anchor to the current draft"
	}
	for _, raw := range candidates {
		item := obj(raw)
		if str(item["id"]) == "" || str(item["anchor"]) == "" || !strings.Contains(text, str(item["anchor"])) {
			return "Figure candidates must anchor to the current draft"
		}
	}
	if phase == "choose" {
		return ""
	}
	selected := ids(figure["selected"])
	if !subset(selected, itemIDs(candidates)) {
		return "Figure selection must reference candidates"
	}
	switch phase {
	case "compose":
		if target, present := figure["recompose"]; present && !subset(ids(target), selected) {
			return "Recompose must reference the selection"
		}
		return ""
	case "design":
		for _, item := range filterItems(candidates, selected) {
			if _, ok := item["scene"].(string); !ok {
				return "Every selected figure needs a design"
			}
		}
		return ""
	}
	failed, made := keys(obj(figure["failed"])), itemIDs(figure["items"])
	for _, id := range failed {
		if !slices.Contains(selected, id) || slices.Contains(made, id) {
			return "Failed figures must be selected and not prepared"
		}
	}
	if phase == "generate" {
		batch, pass := current(figure)
		if (pass != drawPass && pass != fixPass) || !subset(batch, selected) {
			return "Figure generation step is invalid"
		}
		for _, id := range made {
			if !slices.Contains(selected, id) || slices.Contains(batch, id) {
				return "Finished figures must not be in the current batch"
			}
		}
		previous := drafts(figure)
		if pass == drawPass && len(previous) > 0 {
			return "First pass has no draft"
		}
		if pass == fixPass {
			for _, id := range batch {
				if obj(previous[id])["id"] != id {
					return "Figure draft must match the current figures"
				}
			}
		}
		return ""
	}
	if !subset(made, selected) {
		return "Figures must match the selection"
	}
	return ""
}
