package figureai

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/pollux-o4/AIN/backend/internal/figuredomain"
)

type SVGDrawResult struct {
	SVG     string
	Alt     string
	Caption *string
	Model   *string
	Tokens  *int64
	Checks  int
}

type SVGDraw func(context.Context, RouteInput, string) (SVGDrawResult, error)

// SVGRoute converts an injected draw port to the shared figure route contract.
func SVGRoute(id, version string, maxChecks int, draw SVGDraw) RouteAdapter {
	adapter := RouteAdapter{ID: id, Version: version, Route: "svg",
		Capabilities: RouteCapabilities{Motion: true, TextInImage: true, PartialEdit: true, MaxChecks: maxChecks}}
	if draw == nil {
		return adapter
	}
	adapter.Render = func(ctx context.Context, input RouteInput, dir string) (RouteOutput, error) {
		made, err := draw(ctx, input, dir)
		if err != nil {
			return RouteOutput{}, err
		}
		svg, err := figuredomain.NormalizeSVG(made.SVG)
		if err != nil {
			return RouteOutput{}, err
		}
		if len(svg) > svgLimit {
			return RouteOutput{}, errors.New("figure SVG exceeds byte limit")
		}
		if err := ctx.Err(); err != nil {
			return RouteOutput{}, err
		}
		const filename = "figure.svg"
		if err := writeRouteSVG(dir, filename, svg); err != nil {
			return RouteOutput{}, err
		}
		var labels []RouteLabel
		for _, label := range input.Labels {
			if strings.Contains(svg, label.Text) {
				labels = append(labels, RouteLabel{Text: label.Text})
			}
		}
		return RouteOutput{
			Files: []RouteFile{{Path: filename, MIME: "image/svg+xml"}},
			Alt:   made.Alt, Caption: made.Caption, Motion: IsAnimated(svg), Labels: labels,
			Model: made.Model, Tokens: made.Tokens, Checks: made.Checks,
		}, nil
	}
	return adapter
}

func writeRouteSVG(dir, filename, svg string) error {
	root, err := os.OpenRoot(dir)
	if err != nil {
		return err
	}
	defer root.Close()
	name := ".figure-svg-" + uuid.NewString()
	temp, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	defer root.Remove(name)
	_, writeErr := temp.WriteString(svg)
	if err := errors.Join(writeErr, temp.Close()); err != nil {
		return err
	}
	return root.Rename(name, filename)
}

type ImageGenerateResult struct {
	Path   string
	MIME   string
	Alt    string
	Model  *string
	Tokens *int64
	Labels []RouteLabel
}

type ImageGenerate func(ctx context.Context, prompt, dir string) (ImageGenerateResult, error)

// ImageRoute configures an image adapter only when a caller supplies its port.
// shortcut: 현재 편집 상태는 인라인 SVG만 저장해 독립 결과 계약으로 검증, 파일형 결과 저장과 렌더 포트를 연결할 때 재검토.
func ImageRoute(id, version string, textInImage bool, generate ImageGenerate) RouteAdapter {
	adapter := RouteAdapter{ID: id, Version: version, Route: "image",
		Capabilities: RouteCapabilities{TextInImage: textInImage}}
	if generate == nil {
		return adapter
	}
	adapter.Render = func(ctx context.Context, input RouteInput, dir string) (RouteOutput, error) {
		made, err := generate(ctx, ImageRoutePrompt(input, textInImage), dir)
		if err != nil {
			return RouteOutput{}, err
		}
		labels := made.Labels
		if textInImage {
			labels = make([]RouteLabel, 0, len(input.Labels))
			for _, label := range input.Labels {
				labels = append(labels, RouteLabel{Text: label.Text})
			}
		}
		return RouteOutput{
			Files: []RouteFile{{Path: made.Path, MIME: made.MIME}},
			Alt:   made.Alt, Labels: labels, Model: made.Model, Tokens: made.Tokens,
		}, nil
	}
	return adapter
}

func ImageRoutePrompt(input RouteInput, textInImage bool) string {
	var result []string
	add := func(name, section string) {
		if section != "" {
			result = append(result, fmt.Sprintf("%s: %s", name, section))
		}
	}
	keys := make([]string, 0, len(input.Style))
	for key := range input.Style {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	style := make([]string, 0, len(keys))
	for _, key := range keys {
		style = append(style, input.Style[key])
	}
	add("Style", strings.Join(style, " / "))
	add("Message", input.Message)
	elements := make([]string, 0, len(input.Elements))
	for _, element := range input.Elements {
		elements = append(elements, element.Name)
	}
	add("Elements", strings.Join(elements, ", "))
	motifs := make([]string, 0, len(input.Motifs))
	for _, motif := range input.Motifs {
		motifs = append(motifs, motif.Name+": "+motif.Look)
	}
	add("Recurring objects", strings.Join(motifs, "; "))
	add("Layout", strings.Join(input.Regions, "; "))
	if input.Direction != nil {
		add("Direction", *input.Direction)
	}
	text := "No text, letters or numbers in the image."
	if textInImage {
		labels := make([]string, 0, len(input.Labels))
		for _, label := range input.Labels {
			labels = append(labels, "\""+label.Text+"\"")
		}
		text = "Render exactly these Korean labels: " + strings.Join(labels, ", ")
	}
	add("Text", text)
	return strings.Join(result, "\n")
}
