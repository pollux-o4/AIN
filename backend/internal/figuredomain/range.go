package figuredomain

import (
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

const maxRange = 1500

var lineMarks = regexp.MustCompile(`(?m)^ {0,3}(?:#{1,6}[\t ]+|[-+*][\t ]+|\d+[.)][\t ]+)`)
var links = regexp.MustCompile(`\[([^\]\n]+)\]\([^\n)]*\)`)
var unitHead = regexp.MustCompile(`(?m)^#{2,}[\t ]+`)

type span struct{ start, end int }

func units(value string) int {
	result := 0
	for _, r := range value {
		result++
		if r >= 0x10000 {
			result++
		}
	}
	return result
}

func truncate(value string, limit int) string {
	size := 0
	for at, r := range value {
		size++
		if r >= 0x10000 {
			size++
		}
		if size > limit {
			return value[:at]
		}
	}
	return value
}

func bounded(value any, limit int) bool {
	return trimmed(value) != "" && units(str(value)) <= limit
}

func collapse(value string) string {
	var result strings.Builder
	space := false
	for _, r := range value {
		if unicode.IsSpace(r) {
			if !space {
				result.WriteByte(' ')
			}
			space = true
			continue
		}
		space = false
		result.WriteRune(r)
	}
	return result.String()
}

func projection(markdown string) (string, []span) {
	hidden := make([]bool, len(markdown))
	hide := func(start, end int) {
		for i := start; i < end; i++ {
			hidden[i] = true
		}
	}
	for _, m := range lineMarks.FindAllStringIndex(markdown, -1) {
		hide(m[0], m[1])
	}
	for _, m := range links.FindAllStringSubmatchIndex(markdown, -1) {
		hide(m[0], m[2])
		hide(m[3], m[1])
	}
	for at := 0; at < len(markdown); {
		marker := inlineMarker(markdown[at:])
		if marker == "" {
			at++
			continue
		}
		from := at + len(marker)
		end := inlineEnd(markdown, from, marker)
		if end < 0 {
			at = from
			continue
		}
		hide(at, from)
		hide(end, end+len(marker))
		at = end + len(marker)
	}
	var plain strings.Builder
	var spans []span
	space := false
	for at, r := range markdown {
		length := utf8.RuneLen(r)
		if hidden[at] {
			continue
		}
		if unicode.IsSpace(r) {
			if plain.Len() == 0 {
				continue
			}
			if space {
				spans[len(spans)-1].end = at + length
				continue
			}
			plain.WriteByte(' ')
			spans = append(spans, span{at, at + length})
			space = true
			continue
		}
		space = false
		plain.WriteRune(r)
		for i := 0; i < length; i++ {
			spans = append(spans, span{at, at + length})
		}
	}
	text := plain.String()
	if space {
		return text[:len(text)-1], spans[:len(spans)-1]
	}
	return text, spans
}

func inlineMarker(text string) string {
	switch text[0] {
	case '*', '_':
		if len(text) > 1 && text[0] == text[1] {
			return text[:2]
		}
		return text[:1]
	case '`':
		end := 1
		for end < len(text) && text[end] == '`' {
			end++
		}
		return text[:end]
	}
	return ""
}

func inlineEnd(text string, start int, marker string) int {
	if start >= len(text) {
		return -1
	}
	first, _ := utf8.DecodeRuneInString(text[start:])
	if unicode.IsSpace(first) {
		return -1
	}
	line, _, _ := strings.Cut(text[start:], "\n")
	for search := 1; search < len(line); {
		offset := strings.Index(line[search:], marker)
		if offset < 0 {
			break
		}
		end := search + offset
		last, _ := utf8.DecodeLastRuneInString(line[:end])
		if !unicode.IsSpace(last) {
			return start + end
		}
		search = end + 1
	}
	return -1
}

var placementErrors = map[string]string{
	"not_found":    "선택한 글을 본문에서 찾을 수 없습니다.",
	"ambiguous":    "같은 글이 여러 곳에 있습니다. 앞뒤 글을 함께 골라 주세요.",
	"crosses_unit": "소제목 경계를 넘지 않도록 범위를 골라 주세요.",
	"overlaps":     "다른 시각자료 후보의 범위와 겹칩니다.",
	"too_long":     "시각자료 범위는 1500자 이내로 골라 주세요.",
	"full":         "시각자료 후보는 30개까지입니다.",
	"unknown":      "시각자료 후보를 찾을 수 없습니다.",
	"ai_claim":     "AI 후보의 주장은 바꿀 수 없습니다.",
	"ai_remove":    "직접 추가한 자리만 취소할 수 있습니다.",
}

func resolveQuote(text string, quote object, candidates []object) (string, string) {
	exact := strings.TrimSpace(collapse(str(quote["exact"])))
	if exact == "" {
		return "", "not_found"
	}
	if units(exact) > maxRange {
		return "", "too_long"
	}
	plain, spans := projection(text)
	prefix, pref := quote["prefix"].(string)
	suffix, suff := quote["suffix"].(string)
	prefix, suffix = collapse(prefix), collapse(suffix)
	found := -1
	for start := 0; start < len(plain); {
		offset := strings.Index(plain[start:], exact)
		if offset < 0 {
			break
		}
		at := start + offset
		start = at + 1
		if (pref && !strings.HasSuffix(plain[:at], prefix)) || (suff && !strings.HasPrefix(plain[at+len(exact):], suffix)) {
			continue
		}
		if found >= 0 {
			return "", "ambiguous"
		}
		found = at
	}
	if found < 0 {
		return "", "not_found"
	}
	start, end := spans[found].start, spans[found+len(exact)-1].end
	anchor := text[start:end]
	if units(anchor) > maxRange {
		return "", "too_long"
	}
	for _, match := range unitHead.FindAllStringIndex(text, -1) {
		if start < match[0] && match[0] < end {
			return "", "crosses_unit"
		}
	}
	for _, candidate := range candidates {
		other := str(candidate["anchor"])
		if at := strings.Index(text, other); at >= 0 && start < at+len(other) && at < end {
			return "", "overlaps"
		}
	}
	return anchor, ""
}

func editPlacement(kind, text string, raw any, event object) ([]object, error) {
	pool := itemIDs(raw)
	candidates := filterItems(raw, pool)
	id := str(event["figure"])
	at := slices.Index(pool, id)
	target := object{}
	if id != "" {
		if at < 0 {
			return nil, errors.New(placementErrors["unknown"])
		}
		target = candidates[at]
	}
	if kind == "remove_figure" {
		if target["origin"] != "human" {
			return nil, errors.New(placementErrors["ai_remove"])
		}
		return withoutItems(candidates, []string{id}), nil
	}
	claim := trimmed(event["claim"])
	_, claimSet := event["claim"]
	if id != "" && claimSet && target["origin"] != "human" {
		return nil, errors.New(placementErrors["ai_claim"])
	}
	if id == "" {
		if len(candidates) >= maxCandidates {
			return nil, errors.New(placementErrors["full"])
		}
		if !bounded(event["claim"], 300) {
			return nil, errors.New("New figure requires a claim")
		}
	}
	anchor, code := resolveQuote(text, obj(event["quote"]), withoutItems(candidates, []string{id}))
	if code != "" {
		return nil, errors.New(placementErrors[code])
	}
	if id != "" {
		next := omit(target)
		next["anchor"] = anchor
		if claim != "" {
			next["claim"], next["reason"] = claim, claim
		}
		candidates[at] = next
		return candidates, nil
	}
	for n := 1; n <= 99; n++ {
		if proposed := fmt.Sprintf("f%d", n); !slices.Contains(pool, proposed) {
			id = proposed
			break
		}
	}
	if id == "" {
		return nil, errors.New(placementErrors["full"])
	}
	position := strings.Index(text, anchor)
	at = slices.IndexFunc(candidates, func(candidate object) bool { return strings.Index(text, str(candidate["anchor"])) > position })
	if at < 0 {
		at = len(candidates)
	}
	return slices.Insert(candidates, at, object{"id": id, "anchor": anchor, "claim": claim, "reason": claim, "origin": "human"}), nil
}
