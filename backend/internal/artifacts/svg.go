package artifacts

import (
	"encoding/xml"
	"errors"
	"io"
	"regexp"
	"strings"
	"unicode/utf16"
)

type span struct{ start, end int }

type svgDocument struct {
	body     string
	rootEnd  int
	remove   []span
	animated bool
}

const svgFreeze = "<style>*{animation:none!important;transition:none!important}</style>"

var (
	svgURL       = regexp.MustCompile(`(?i)url\s*\(([^)]*)\)`)
	svgAnimation = regexp.MustCompile(`(?i)@keyframes|animation\s*:`)
	errUnsafeSVG = errors.New("unsafe or malformed saved SVG")
)

func smil(name string) bool {
	switch name {
	case "animate", "animatetransform", "animatemotion", "set":
		return true
	default:
		return false
	}
}

func safeSVGValue(value string) bool {
	lower := strings.ToLower(value)
	if strings.Contains(lower, "javascript:") || strings.Contains(lower, "@import") {
		return false
	}
	for _, match := range svgURL.FindAllStringSubmatch(value, -1) {
		ref := strings.Trim(strings.TrimSpace(match[1]), `"'`)
		if !strings.HasPrefix(ref, "#") {
			return false
		}
	}
	return true
}

func parseSVG(body string) (svgDocument, error) {
	// Legacy save limits SVG by JavaScript UTF-16 code units.
	trimmed := strings.TrimSpace(body)
	if len(body) > 1_200_000 || len(utf16.Encode([]rune(body))) > 400_000 ||
		!strings.HasPrefix(trimmed, "<svg") || !strings.HasSuffix(trimmed, "</svg>") {
		return svgDocument{}, errUnsafeSVG
	}
	decoder := xml.NewDecoder(strings.NewReader(body))
	result := svgDocument{body: body, animated: svgAnimation.MatchString(body)}
	depth, styleDepth, motionDepth, motionStart := 0, 0, 0, 0
	for {
		start := int(decoder.InputOffset())
		token, err := decoder.Token()
		if err == io.EOF {
			if result.rootEnd == 0 || depth != 0 {
				return svgDocument{}, errUnsafeSVG
			}
			return result, nil
		}
		if err != nil {
			return svgDocument{}, errUnsafeSVG
		}
		switch token := token.(type) {
		case xml.StartElement:
			name := strings.ToLower(token.Name.Local)
			switch name {
			case "script", "foreignobject", "iframe", "object", "embed", "image", "feimage", "a", "audio", "video", "handler", "link":
				return svgDocument{}, errUnsafeSVG
			}
			if depth == 0 {
				if result.rootEnd != 0 || token.Name.Local != "svg" ||
					(token.Name.Space != "" && token.Name.Space != "http://www.w3.org/2000/svg") {
					return svgDocument{}, errUnsafeSVG
				}
				result.rootEnd = int(decoder.InputOffset())
			}
			depth++
			if name == "style" {
				styleDepth = depth
			}
			if smil(name) && motionDepth == 0 {
				result.animated = true
				motionDepth, motionStart = depth, start
			}
			for _, attr := range token.Attr {
				key := strings.ToLower(attr.Name.Local)
				value := strings.TrimSpace(attr.Value)
				if key == "base" || strings.HasPrefix(key, "on") || !safeSVGValue(value) ||
					((key == "href" || key == "src") && !strings.HasPrefix(value, "#")) ||
					(key == "style" && strings.Contains(value, `\`)) {
					return svgDocument{}, errUnsafeSVG
				}
				if key == "attributename" {
					target := strings.TrimPrefix(strings.ToLower(value), "xlink:")
					if strings.HasPrefix(target, "on") || target == "href" || target == "src" {
						return svgDocument{}, errUnsafeSVG
					}
				}
			}
		case xml.EndElement:
			if motionDepth == depth {
				result.remove = append(result.remove, span{motionStart, int(decoder.InputOffset())})
				motionDepth = 0
			}
			if styleDepth == depth {
				styleDepth = 0
			}
			depth--
		case xml.CharData:
			if depth == 0 && strings.TrimSpace(string(token)) != "" {
				return svgDocument{}, errUnsafeSVG
			}
			if styleDepth > 0 && (!safeSVGValue(string(token)) || strings.Contains(string(token), `\`)) {
				return svgDocument{}, errUnsafeSVG
			}
		case xml.Directive, xml.ProcInst:
			return svgDocument{}, errUnsafeSVG
		}
	}
}

func (d svgDocument) static() string {
	if !d.animated {
		return d.body
	}
	var output strings.Builder
	output.WriteString(d.body[:d.rootEnd])
	output.WriteString(svgFreeze)
	from := d.rootEnd
	for _, span := range d.remove {
		output.WriteString(d.body[from:span.start])
		from = span.end
	}
	output.WriteString(d.body[from:])
	return output.String()
}
