package writingai

import (
	"encoding/json"
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

const summaryHeading = "## 한눈에 정리"

var (
	linkAddress = regexp.MustCompile(`\]\([^)]*\)`)
	sectionLine = regexp.MustCompile(`(?m)^##\s`)
	headingLine = regexp.MustCompile(`^(#{2,})\s+(.+?)\s*$`)
	titleLine   = regexp.MustCompile(`(?m)^#\s+(.+)$`)
	countedHead = regexp.MustCompile(`(?m)^#{2,6}\s.+$`)
	blankLine   = regexp.MustCompile(`\n\s*\n`)
	boldText    = regexp.MustCompile(`\*\*[^*\n]+\*\*`)
	listLine    = regexp.MustCompile(`^\s*(?:[-*+]|\d+\.)\s`)
	summaryLine = regexp.MustCompile(`^\s*[-*]\s+(.+?)\s*$`)
	formatChars = strings.NewReplacer("*", "", "_", "", "`", "")
)

func jsSpace(r rune) bool { return r == '\uFEFF' || r != '\u0085' && unicode.IsSpace(r) }

func utf16Count(text string) int {
	count := 0
	for _, r := range text {
		count++
		if r > 0xffff {
			count++
		}
	}
	return count
}

func readerCount(text string) int {
	return utf8.RuneCountInString(linkAddress.ReplaceAllString(text, "]"))
}

func splitArticle(text string) (string, []string) {
	matches := sectionLine.FindAllStringIndex(text, -1)
	if len(matches) == 0 {
		return text, nil
	}
	var sections []string
	for i, start := range matches {
		end := len(text)
		if i+1 < len(matches) {
			end = matches[i+1][0]
		}
		sections = append(sections, text[start[0]:end])
	}
	for i, part := range sections {
		line, _, _ := strings.Cut(part, "\n")
		if strings.TrimFunc(line, jsSpace) == summaryHeading {
			if i > 0 {
				sections[i-1] = strings.Join(sections[i-1:], "")
				sections = sections[:i]
			}
			break
		}
	}
	return text[:matches[0][0]], sections
}

func splitSummary(text string) (string, []string) {
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		if strings.TrimFunc(line, jsSpace) != summaryHeading {
			continue
		}
		summary := []string{}
		for _, line := range lines[i+1:] {
			if match := summaryLine.FindStringSubmatch(line); match != nil {
				summary = append(summary, match[1])
			}
		}
		return strings.Join(lines[:i], "\n"), summary
	}
	return text, []string{}
}

func closingLine(part string) string {
	body, _ := splitSummary(part)
	for _, paragraph := range slices.Backward(blankLine.Split(body, -1)) {
		paragraph = strings.TrimFunc(paragraph, jsSpace)
		if paragraph != "" && !strings.HasPrefix(paragraph, "#") {
			return paragraph
		}
	}
	return ""
}

func proseLines(text string) []string {
	lines := []string{}
	fenced := false
	for _, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(line, "```") {
			fenced = !fenced
		}
		trimmed := strings.TrimLeftFunc(line, jsSpace)
		if !fenced && !strings.HasPrefix(trimmed, "#") && !strings.HasPrefix(trimmed, "|") && !strings.HasPrefix(trimmed, "```") {
			lines = append(lines, line)
		}
	}
	return lines
}

func sentenceLengths(text string) []int {
	prose := strings.Join(proseLines(text), " ")
	lengths := []int{}
	add := func(fragment string) {
		if size := utf8.RuneCountInString(strings.TrimFunc(fragment, jsSpace)); size > 1 {
			lengths = append(lengths, size)
		}
	}
	var start int
	for i, r := range prose {
		after := i + utf8.RuneLen(r)
		if after >= len(prose) || !strings.ContainsRune(".!?。", r) {
			continue
		}
		next, _ := utf8.DecodeRuneInString(prose[after:])
		if jsSpace(next) || strings.HasSuffix(prose[start:after], "다.") {
			add(prose[start:after])
			start = after
		}
	}
	add(prose[start:])
	return lengths
}

func paragraphs(text string) []string {
	result := []string{}
	for _, chunk := range blankLine.Split(text, -1) {
		lines := proseLines(chunk)
		start := 0
		add := func(chunk []string) {
			if value := strings.TrimFunc(strings.Join(chunk, "\n"), jsSpace); value != "" {
				result = append(result, value)
			}
		}
		for i, line := range lines {
			if i > start && listLine.MatchString(line) {
				add(lines[start:i])
				start = i
			}
		}
		add(lines[start:])
	}
	return result
}

type heading struct {
	level  int
	title  string
	parent int
}

func headings(text string) []heading {
	list := []heading{}
	fenced := false
	for _, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(line, "```") {
			fenced = !fenced
		}
		if fenced {
			continue
		}
		match := headingLine.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		if strings.TrimFunc(line, jsSpace) == summaryHeading {
			break
		}
		level := len(match[1])
		parent := len(list) - 1
		for parent >= 0 && list[parent].level >= level {
			parent = list[parent].parent
		}
		list = append(list, heading{level, match[2], parent})
	}
	return list
}

func plain(text string) string {
	return strings.Join(strings.FieldsFunc(formatChars.Replace(text), jsSpace), " ")
}

type sectionShape struct {
	Questions      int `json:"questions"`
	Bold           int `json:"bold"`
	LongParagraphs int `json:"longParagraphs"`
}

func measureDraft(text string, outline object) json.RawMessage {
	lengths := sentenceLengths(text)
	slices.Sort(lengths)
	percentile := func(p float64) int {
		if len(lengths) == 0 {
			return 0
		}
		return lengths[min(len(lengths)-1, int(float64(len(lengths))*p))]
	}
	longestParagraph := 0
	for _, paragraph := range paragraphs(text) {
		longestParagraph = max(longestParagraph, utf8.RuneCountInString(paragraph))
	}
	positions := countedHead.FindAllStringIndex(text, -1)
	longestSection := 0
	for i, match := range positions {
		end := len(text)
		if i+1 < len(positions) {
			end = positions[i+1][0]
		}
		longestSection = max(longestSection, utf16Count(text[match[0]:end]))
	}
	out := ordered{}
	out.set("sentenceLength", ordered{{"median", encode(percentile(.5))}, {"p90", encode(percentile(.9))}}.raw())
	out.set("longestParagraph", encode(longestParagraph))
	out.set("headingCount", encode(len(positions)))
	nodes := headings(text)
	if outline["sections"] != nil {
		out.set("missingHeadings", encode(missingHeadings(nodes, values(outline["sections"]))))
	}
	out.set("headingTree", measureHeadingTree(nodes))
	out.set("longestSection", encode(longestSection))
	_, parts := splitArticle(text)
	shapes := make([]sectionShape, 0, len(parts))
	for _, part := range parts {
		shape := sectionShape{Questions: strings.Count(part, "?"), Bold: len(boldText.FindAllStringIndex(part, -1))}
		for _, paragraph := range paragraphs(part) {
			if len(sentenceLengths(paragraph)) > 6 {
				shape.LongParagraphs++
			}
		}
		shapes = append(shapes, shape)
	}
	out.set("sections", encode(shapes))
	out.set("cardTransfer", cardTransfer(text, outline))
	return out.raw()
}

func measureHeadingTree(nodes []heading) json.RawMessage {
	depth, skipped, singles, maxSiblings := 1, 0, 0, 0
	children := map[int]int{}
	for _, node := range nodes {
		depth = max(depth, node.level)
		parentLevel := 1
		if node.parent >= 0 {
			parentLevel = nodes[node.parent].level
		}
		if node.level > parentLevel+1 {
			skipped++
		}
		children[node.parent]++
	}
	for parent, count := range children {
		maxSiblings = max(maxSiblings, count)
		if parent >= 0 && count == 1 {
			singles++
		}
	}
	return ordered{{"depth", encode(depth)}, {"skippedLevels", encode(skipped)},
		{"singleChildren", encode(singles)}, {"maxSiblings", encode(maxSiblings)}}.raw()
}

func missingHeadings(nodes []heading, sections []json.RawMessage) []string {
	present := map[string]bool{}
	for _, node := range nodes {
		present[plain(strings.Repeat("#", node.level)+" "+node.title)] = true
	}
	missing := []string{}
	var walk func([]json.RawMessage, int)
	walk = func(items []json.RawMessage, level int) {
		for _, item := range items {
			card := fields(item)
			title := strings.TrimFunc(stringOf(card["title"]), jsSpace)
			if level == 2 && isString(item) {
				title = stringOf(item)
			}
			if title == "" {
				continue
			}
			if !present[plain(strings.Repeat("#", level)+" "+title)] {
				missing = append(missing, title)
			}
			walk(values(card["subsections"]), level+1)
		}
	}
	walk(sections, 2)
	return missing
}

func cardTransfer(text string, outline object) json.RawMessage {
	count := 0
	for _, raw := range values(outline["sections"]) {
		card := fields(raw)
		mode := stringOf(card["mode"])
		if mode != "procedure" && slices.Contains(templates.Modes, mode) {
			for _, key := range []string{"hook", "cases", "principleLine", "underline"} {
				if truthy(card[key]) {
					count++
					break
				}
			}
		}
	}
	title := stringOf(outline["title"])
	if count == 0 && title == "" {
		return nil
	}
	out := ordered{}
	if title != "" {
		titleText := ""
		if match := titleLine.FindStringSubmatch(text); match != nil {
			titleText = match[1]
		}
		out.set("titleMatches", encode(plain(titleText) == plain(title)))
	}
	body, summary := splitSummary(text)
	body = plain(body)
	missing := []string{}
	for _, item := range summary {
		if !strings.Contains(body, plain(item)) {
			missing = append(missing, item)
		}
	}
	out.set("summaryNotInBody", encode(missing))
	out.set("summaryCount", ordered{{"expected", encode(count)}, {"actual", encode(len(summary))}}.raw())
	return out.raw()
}
