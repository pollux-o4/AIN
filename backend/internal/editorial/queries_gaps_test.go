package editorial

import (
	"slices"
	"strconv"
	"strings"
)

// MIG-025 currently permits these observed differences while the Node response
// shapes are being ported. AIN_REQUIRE_QUERY_PARITY=1 checks every field.
var knownQueryGaps = strings.Fields(`
	detail/appliedOperations/*
	detail/brief
	detail/busy
	detail/canApproveBrief
	detail/canApproveDesign
	detail/canCompleteRequirements
	detail/canConfirmFigures
	detail/canDiscardFigures
	detail/canDownload
	detail/canFeedback
	detail/canRequestFigures
	detail/canReviseFigures
	detail/canSelectFigures
	detail/changes
	detail/completionReason
	detail/design
	detail/executionLinks
	detail/figure/candidates/*/analogy
	detail/figure/candidates/*/direction
	detail/figure/candidates/*/kind
	detail/figure/candidates/*/look
	detail/figure/candidates/*/lookBy
	detail/figure/candidates/*/mapping
	detail/figure/candidates/*/motifs
	detail/figure/candidates/*/origin
	detail/figure/candidates/*/quote
	detail/figure/candidates/*/route
	detail/figure/candidates/*/scene
	detail/figure/candidates/*/without
	detail/figure/current
	detail/figure/failed
	detail/figure/feedback
	detail/figure/motifs
	detail/figure/recompose
	detail/figure/style
	detail/figure/world
	detail/findings
	detail/issue
	detail/label
	detail/model
	detail/monitor/canResume
	detail/monitor/events/*/executionId
	detail/monitor/executionId
	detail/monitor/kind
	detail/monitor/label
	detail/monitor/lastConfirmedAt
	detail/monitor/pipeline
	detail/monitor/pipeline/*/status
	detail/monitor/resumeLabel
	detail/needsCompletion
	detail/previous/*/needsCompletion
	detail/previous/*/reviewed
	detail/previous/*/stage
	detail/previous/*/status
	detail/requirements
	detail/stage
	detail/title
	detail/unmetRequirements
	detail/updatedAt

	history/journey/*/direction
	history/journey/*/findings
	history/journey/*/request
	history/journey/*/summary
	history/records/*/goal
	history/records/*/inputs
	history/records/*/inputsSource
	history/records/*/model
	history/records/*/name
	history/records/*/output
	history/records/*/reason
	history/records/*/resultSource
	history/records/*/steps
	history/records/*/target
	history/records/*/unavailable
	history/usage/calls
	history/usage/hotspots
	history/usage/ms
	history/usage/revisions
	history/usage/tokens
	history/usage/wasted

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
