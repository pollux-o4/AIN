package figuredomain

import (
	"slices"
	"sort"
	"strings"
)

// Spots separates placement data from execution: busy means a job was
// observed running, while a selected but unstarted candidate stays queued.
func Spots(figure map[string]any, busy bool) []map[string]any {
	phase := str(figure["phase"])
	spots := []object{}
	if phase == "choose" {
		for _, raw := range list(figure["candidates"]) {
			item := omit(obj(raw))
			item["spot"] = "candidate"
			spots = append(spots, item)
		}
		return spots
	}
	if phase == "confirmed" {
		for _, raw := range list(figure["items"]) {
			item := omit(obj(raw))
			item["item"] = raw
			spots = append(spots, item)
		}
		return spots
	}
	if !slices.Contains([]string{"compose", "design", "generate", "review"}, phase) {
		return spots
	}
	prepared := indexItems(figure["items"])
	candidates := indexItems(figure["candidates"])
	failed := obj(figure["failed"])
	var working []string
	if phase == "generate" {
		working, _ = current(figure)
	}
	for _, id := range ids(figure["selected"]) {
		if item := prepared[id]; item != nil {
			spot := omit(item)
			spot["item"] = item
			spots = append(spots, spot)
			continue
		}
		candidate := candidates[id]
		if candidate == nil {
			continue
		}
		spot := omit(candidate)
		switch {
		case failed[id] != nil:
			spot["spot"], spot["error"] = "failed", failed[id]
		case phase == "compose":
			spot["spot"] = "stopped"
			if busy {
				spot["spot"] = "composing"
			}
		case phase == "design":
			spot["spot"] = "design"
		case !slices.Contains(working, id):
			spot["spot"] = "queued"
		default:
			spot["spot"] = "stopped"
			if busy {
				spot["spot"] = "drawing"
			}
		}
		spots = append(spots, spot)
	}
	return spots
}

type Segment struct {
	Text   string
	Figure map[string]any
}

// Place inserts visual slots after their anchor paragraphs without changing
// any bytes of the article, including blank lines inside fenced code blocks.
func Place(text string, figures []map[string]any) []Segment {
	var fences []int
	for offset := 0; offset < len(text); {
		line, _, _ := strings.Cut(text[offset:], "\n")
		if strings.HasPrefix(line, "```") {
			fences = append(fences, offset)
		}
		offset += len(line) + 1
	}
	type cut struct {
		end    int
		figure object
	}
	var cuts []cut
	for _, figure := range figures {
		anchor := str(figure["anchor"])
		position := strings.Index(text, anchor)
		if anchor == "" || position < 0 {
			continue
		}
		end := position + len(anchor)
		for {
			width := strings.Index(text[end:], "\n\n")
			if width < 0 {
				end = len(text)
				break
			}
			end += width
			if n := sort.SearchInts(fences, end); n%2 == 0 {
				break
			}
			end += 2
		}
		cuts = append(cuts, cut{end, figure})
	}
	sort.SliceStable(cuts, func(i, j int) bool { return cuts[i].end < cuts[j].end })
	parts := []Segment{}
	from := 0
	for _, cut := range cuts {
		if cut.end > from {
			parts = append(parts, Segment{Text: text[from:cut.end]})
		}
		parts = append(parts, Segment{Figure: cut.figure})
		from = cut.end
	}
	if from < len(text) {
		parts = append(parts, Segment{Text: text[from:]})
	}
	return parts
}
