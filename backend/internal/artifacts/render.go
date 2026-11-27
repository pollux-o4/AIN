package artifacts

import (
	"bytes"
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strings"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	gfm "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	html "github.com/yuin/goldmark/renderer/html"
	"github.com/yuin/goldmark/util"
)

var (
	fenceLine  = regexp.MustCompile("(?m)^\x60\x60\x60")
	htmlEscape = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;")
	markdown   = newMarkdown()
)

func newMarkdown() goldmark.Markdown {
	blocks := slices.DeleteFunc(parser.DefaultBlockParsers(), func(p util.PrioritizedValue) bool {
		return p.Value == parser.NewHTMLBlockParser()
	})
	inlines := slices.DeleteFunc(parser.DefaultInlineParsers(), func(p util.PrioritizedValue) bool {
		return p.Value == parser.NewRawHTMLParser() || p.Value == parser.NewEmphasisParser()
	})
	inlines = append(inlines, util.Prioritized(cjkDelimiter{}, 500))
	return goldmark.New(
		goldmark.WithParser(parser.NewParser(
			parser.WithBlockParsers(blocks...),
			parser.WithInlineParsers(inlines...),
			parser.WithParagraphTransformers(parser.DefaultParagraphTransformers()...),
		)),
		goldmark.WithExtensions(extension.Table),
		goldmark.WithRendererOptions(renderer.WithNodeRenderers(util.Prioritized(markdownNodes{}, 100))),
	)
}

// User Markdown can create a link, while only approved figure slots emit img elements.
type markdownNodes struct{}

func (markdownNodes) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(ast.KindImage, markdownImageLink)
	reg.Register(gfm.KindStrikethrough, func(w util.BufWriter, _ []byte, _ ast.Node, entering bool) (ast.WalkStatus, error) {
		tag := "</s>"
		if entering {
			tag = "<s>"
		}
		_, err := w.WriteString(tag)
		return ast.WalkContinue, err
	})
}

func markdownImageLink(w util.BufWriter, _ []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	image := node.(*ast.Image)
	url := util.URLEscape(image.Destination, true)
	if entering {
		if html.IsDangerousURL(url) {
			return ast.WalkContinue, nil
		}
		title := ""
		if len(image.Title) > 0 {
			title = ` title="` + escape(string(image.Title)) + `"`
		}
		_, err := fmt.Fprintf(w, `!<a href="%s"%s>`, escape(string(url)), title)
		return ast.WalkContinue, err
	}
	if html.IsDangerousURL(url) {
		return ast.WalkContinue, nil
	}
	_, err := w.WriteString("</a>")
	return ast.WalkContinue, err
}

func escape(s string) string { return htmlEscape.Replace(s) }

type spot struct {
	figure figure
	status string
	drawn  bool
}

func spots(group *figureGroup, busy bool) []spot {
	if group == nil {
		return nil
	}
	var result []spot
	switch group.Phase {
	case "choose":
		for _, item := range group.Candidates {
			result = append(result, spot{figure: item, status: "candidate"})
		}
	case "confirmed":
		for _, item := range group.Items {
			result = append(result, spot{figure: item, drawn: true})
		}
	case "compose", "design", "generate", "review":
		items, candidates := indexFigures(group.Items), indexFigures(group.Candidates)
		for _, id := range group.Selected {
			if item, exists := items[id]; exists {
				result = append(result, spot{figure: item, drawn: true})
			} else if candidate, exists := candidates[id]; exists {
				result = append(result, spot{figure: candidate, status: spotStatus(group, id, busy)})
			}
		}
	}
	return result
}

func indexFigures(items []figure) map[string]figure {
	index := make(map[string]figure, len(items))
	for _, item := range items {
		index[item.ID] = item
	}
	return index
}

func spotStatus(group *figureGroup, id string, busy bool) string {
	if group.Failed[id] != "" {
		return "failed"
	}
	switch group.Phase {
	case "compose":
		if busy {
			return "composing"
		}
		return "stopped"
	case "design":
		return "design"
	case "generate":
		if current := group.Current; current == nil || current.IDs == nil && current.ID == id ||
			slices.Contains(current.IDs, id) {
			if busy {
				return "drawing"
			}
			return "stopped"
		}
	}
	return "queued"
}

// Place each figure behind the first paragraph containing its exact saved anchor.
func interleave(source string, items []spot, text func(string) error, add func(spot)) error {
	type cut struct {
		end  int
		spot spot
	}
	fences := fenceLine.FindAllStringIndex(source, -1)
	cuts := make([]cut, 0, len(items))
	for _, item := range items {
		anchor := item.figure.Anchor
		at := strings.Index(source, anchor)
		if at < 0 || anchor == "" {
			continue
		}
		end := at + len(anchor)
		for {
			next := strings.Index(source[end:], "\n\n")
			if next < 0 {
				end = len(source)
				break
			}
			end += next
			before := sort.Search(len(fences), func(i int) bool { return fences[i][0] >= end })
			if before%2 == 0 {
				break
			}
			end += 2
		}
		cuts = append(cuts, cut{end, item})
	}
	slices.SortStableFunc(cuts, func(a, b cut) int { return a.end - b.end })
	from := 0
	for _, cut := range cuts {
		if cut.end > from {
			if err := text(source[from:cut.end]); err != nil {
				return err
			}
		}
		add(cut.spot)
		from = cut.end
	}
	if from < len(source) {
		return text(source[from:])
	}
	return nil
}

func renderArticle(title, source string, items []spot, image func(spot) string) (string, error) {
	var output bytes.Buffer
	body := strings.TrimPrefix(source, "# "+title+"\n")
	err := interleave(body, items,
		func(section string) error { return markdown.Convert([]byte(section), &output) },
		func(item spot) { output.WriteString(image(item)) },
	)
	return output.String(), err
}

func PreviewRun(run contract.Run) (string, error) {
	saved, err := readRecord(run)
	if err != nil {
		return "", err
	}
	return previewRecord(run, saved)
}

func previewRecord(run contract.Run, saved record) (string, error) {
	state := saved.State
	text, _ := state.displayedDraft()
	group := state.currentFigures()
	pending := group != nil && group.Phase != "confirmed"
	busy := state.Status == "waiting_figure" && saved.Issue == ""
	return renderArticle(state.title(), text, spots(group, busy), func(spot spot) string {
		item := spot.figure
		if !figureID.MatchString(item.ID) {
			return ""
		}
		if !spot.drawn {
			return fmt.Sprintf(`<div class="figure-slot" data-candidate="%s" data-spot="%s"></div>`, item.ID, spot.status)
		}
		src := fmt.Sprintf("/write/api/runs/%s/figures/%s?v=%d", run.ID, item.ID, state.Version)
		flag, marker := "", ""
		if pending {
			flag, marker = ` data-pending=""`, `<span class="figure-flag">확인 전</span>`
		}
		caption := item.Claim
		if item.Caption != nil {
			caption = *item.Caption
		}
		return fmt.Sprintf(`<figure class="figure" data-figure="%s"%s><img src="%s" data-motion="%s" alt="%s" loading="lazy"><figcaption>%s%s</figcaption></figure>`,
			item.ID, flag, escape(src+"&motion=static"), escape(src), escape(item.Alt), marker, escape(caption))
	})
}
