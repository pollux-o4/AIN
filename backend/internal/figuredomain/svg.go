package figuredomain

import (
	"encoding/xml"
	"errors"
	"io"
	"regexp"
	"slices"
	"strings"
)

const svgNamespace = "http://www.w3.org/2000/svg"

var svgStart = regexp.MustCompile(`^<svg[\s>]`)
var svgNSAttr = regexp.MustCompile(`^<svg[^>]*\sxmlns=`)
var cssURL = regexp.MustCompile(`(?i)url\(\s*([^)]*)\)`)

func normalizeSVG(raw string) (string, error) {
	malformed := errors.New("Unsafe or malformed SVG")
	text := strings.TrimSpace(raw)
	if units(raw) > 400000 || !svgStart.MatchString(text) || !strings.HasSuffix(text, "</svg>") {
		return "", malformed
	}
	parser := xml.NewDecoder(strings.NewReader(text))
	depth := 0
	style := false
	for {
		token, err := parser.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", malformed
		}
		switch node := token.(type) {
		case xml.Directive, xml.ProcInst:
			return "", malformed
		case xml.StartElement:
			if (depth == 0 && node.Name.Local != "svg") || (node.Name.Space != "" && node.Name.Space != svgNamespace) ||
				slices.Contains([]string{"script", "foreignobject", "iframe", "object", "embed", "image", "a"}, strings.ToLower(node.Name.Local)) {
				return "", malformed
			}
			if strings.EqualFold(node.Name.Local, "style") {
				style = true
			}
			for _, attr := range node.Attr {
				if unsafeSVGAttribute(attr) {
					return "", malformed
				}
			}
			depth++
		case xml.EndElement:
			if strings.EqualFold(node.Name.Local, "style") {
				style = false
			}
			depth--
			if depth == 0 && parser.InputOffset() != int64(len(text)) {
				return "", malformed
			}
		case xml.CharData:
			if style && unsafeCSS(string(node)) {
				return "", malformed
			}
		}
	}
	if depth != 0 {
		return "", malformed
	}
	if !svgNSAttr.MatchString(text) {
		text = `<svg xmlns="` + svgNamespace + `"` + text[4:]
	}
	return text, nil
}

func unsafeSVGAttribute(attr xml.Attr) bool {
	name := strings.ToLower(attr.Name.Local)
	value := strings.TrimSpace(strings.ToLower(attr.Value))
	if strings.HasPrefix(name, "on") || strings.Contains(value, "javascript:") {
		return true
	}
	if name == "href" || name == "src" {
		return !strings.HasPrefix(value, "#")
	}
	if name == "attributename" {
		_, local, qualified := strings.Cut(value, ":")
		if qualified {
			value = local
		}
		return value == "href" || value == "src" || strings.HasPrefix(value, "on")
	}
	return unsafeCSS(value)
}

func unsafeCSS(value string) bool {
	lower := strings.ToLower(value)
	if strings.Contains(lower, "@import") || strings.ContainsRune(lower, '\\') {
		return true
	}
	matches := cssURL.FindAllStringSubmatch(lower, -1)
	if strings.Count(lower, "url(") > len(matches) {
		return true
	}
	for _, match := range matches {
		url := strings.TrimSpace(strings.Trim(match[1], `"' `))
		if !strings.HasPrefix(url, "#") {
			return true
		}
	}
	return false
}
