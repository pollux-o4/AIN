package figureai

import (
	"encoding/xml"
	"io"
	"regexp"
	"slices"
	"strings"

	"github.com/pollux-o4/AIN/backend/internal/figuredomain"
)

var motion = regexp.MustCompile(`(?i)<(animate|animateTransform|animateMotion|set)\b|@keyframes|animation\s*:`)

const frozenStyle = "<style>*{animation:none!important;transition:none!important}</style>"

func IsAnimated(svg string) bool { return motion.MatchString(svg) }

// StaticSVG preserves default attributes, drops SMIL and freezes CSS motion.
// Source is never rewritten in the workspace or the persisted figure.
func StaticSVG(raw string) (string, error) {
	svg, err := figuredomain.NormalizeSVG(raw)
	if err != nil || !IsAnimated(svg) {
		return svg, err
	}
	decoder := xml.NewDecoder(strings.NewReader(svg))
	var static strings.Builder
	var skip int
	var from int64
	first := true
	for {
		start := decoder.InputOffset()
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}
		switch node := token.(type) {
		case xml.StartElement:
			if first {
				first = false
				from = decoder.InputOffset()
				static.WriteString(svg[:from])
				static.WriteString(frozenStyle)
			}
			if skip > 0 {
				skip++
			} else if slices.Contains([]string{"animate", "animatetransform", "animatemotion", "set"}, strings.ToLower(node.Name.Local)) {
				static.WriteString(svg[from:start])
				skip = 1
			}
		case xml.EndElement:
			if skip > 0 {
				skip--
				if skip == 0 {
					from = decoder.InputOffset()
				}
			}
		}
	}
	static.WriteString(svg[from:])
	return static.String(), nil
}
