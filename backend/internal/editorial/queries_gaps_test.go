package editorial

import (
	"slices"
	"strconv"
	"strings"
)

// MIG-025 currently permits these observed differences while the Node response
// shapes are being ported. AIN_REQUIRE_QUERY_PARITY=1 checks every field.
var knownQueryGaps = strings.Fields(`


	list/runs/*/completionReason
	list/runs/*/label
	list/runs/*/needsCompletion
	list/runs/*/title
`)

func knownQueryGap(path string) bool {
	segments := strings.Split(path, "/")
	for i, segment := range segments {
		if _, err := strconv.Atoi(segment); err == nil {
			segments[i] = "*"
		}
	}
	return slices.Contains(knownQueryGaps, strings.Join(segments, "/"))
}
