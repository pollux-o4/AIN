package editorial

import (
	"fmt"
	"slices"
)

type historyTotals struct {
	MS     int64  `json:"ms"`
	Tokens *int64 `json:"tokens"`
	Calls  int    `json:"calls"`
	Wasted int    `json:"wasted"`
}

type historyAttempt struct {
	JobID    *string         `json:"jobId,omitempty"`
	Revision int64           `json:"revision"`
	Stage    string          `json:"stage,omitempty"`
	Section  *historySection `json:"section"`
	Figure   *historyFigure  `json:"figure"`
	Chars    *int64          `json:"chars"`
	historyHotspot
}
type historyHotspot struct {
	Label   string `json:"label"`
	MS      int64  `json:"ms"`
	Tokens  *int64 `json:"tokens"`
	Outcome string `json:"outcome"`
}

type historyStageUsage struct {
	Stage string `json:"stage,omitempty"`
	Name  string `json:"name"`
	historyTotals
	Attempts []historyAttempt `json:"attempts"`
}
type historyRevisionUsage struct {
	Revision int64 `json:"revision"`
	historyTotals
	Stages []historyStageUsage `json:"stages"`
}
type historyUsage struct {
	historyTotals
	Revisions []historyRevisionUsage `json:"revisions"`
	Hotspots  []historyHotspot       `json:"hotspots"`
}

func sumHistoryTokens(a, b *int64) *int64 {
	if b == nil {
		return a
	}
	if a == nil {
		return b
	}
	total := *a + *b
	return &total
}

func (total *historyTotals) add(attempt historyAttempt) {
	total.MS += attempt.MS
	total.Tokens = sumHistoryTokens(total.Tokens, attempt.Tokens)
	total.Calls++
	if attempt.Outcome == "failed" || attempt.Outcome == "rejected" {
		total.Wasted++
	}
}

func attemptLabel(attempt historyAttempt) string {
	label := fmt.Sprintf("회차 %d · %s", attempt.Revision, historyStageName(attempt.Stage))
	if section := attempt.Section; section != nil {
		label += fmt.Sprintf(" %d/%d", section.Index+1, section.Total)
	}
	if figure := attempt.Figure; figure != nil {
		pass := figure.Pass
		if pass == "" {
			pass = "undefined"
		}
		label += " " + figure.ID + " " + pass
	}
	return label
}

type retryLocation struct {
	revision   int64
	stage      string
	hasSection bool
	index      int64
	figure     historyFigure
}

// A backward scan indexes the next matching completion, the next stop, and
// later attempts at the same revision and stage. It does not poll job state.
func attemptsForHistory(events []historyEvent, jobs map[string]*historyJob, now int64) []historyAttempt {
	attempts := make([]historyAttempt, 0)
	completions := make(map[string]int)
	nextStop := -1
	later := make(map[retryLocation]bool)
	for index := len(events) - 1; index >= 0; index-- {
		event := events[index]
		id := historyStringValue(event.JobID)
		switch event.Kind {
		case "ai_completed":
			completions[id] = index
		case "failed", "pause":
			nextStop = index
		case "ai_requested":
			end, outcome := now, "running"
			if done, ok := completions[id]; ok {
				end, outcome = events[done].At, "accepted"
				if done+1 < len(events) && events[done+1].Kind == "failed" && events[done+1].At == end {
					outcome = "rejected"
				}
			} else if nextStop >= 0 {
				end, outcome = events[nextStop].At, "failed"
			}
			attempt := historyAttempt{
				JobID: event.JobID, Revision: event.Revision, Stage: event.Stage,
				historyHotspot: historyHotspot{MS: end - event.At, Outcome: outcome},
			}
			location := retryLocation{revision: event.Revision, stage: event.Stage}
			if job := jobs[id]; job != nil {
				attempt.Tokens, attempt.Chars, attempt.Section, attempt.Figure = job.Tokens, job.Chars, job.Section, job.Figure
				if job.Section != nil {
					location.hasSection, location.index = true, job.Section.Index
				}
				if job.Figure != nil {
					location.figure = *job.Figure
				}
			}
			if later[location] && attempt.Outcome == "accepted" {
				attempt.Outcome = "rejected"
			}
			later[location] = true
			attempt.Label = attemptLabel(attempt)
			attempts = append(attempts, attempt)
		}
	}
	slices.Reverse(attempts)
	return attempts
}

func projectHistoryUsage(events []historyEvent, jobs map[string]*historyJob, now int64) historyUsage {
	report := historyUsage{Revisions: []historyRevisionUsage{}, Hotspots: []historyHotspot{}}
	byRevision := make(map[int64]int)
	byStage := make(map[int64]map[string]int)
	for _, attempt := range attemptsForHistory(events, jobs, now) {
		revisionIndex, exists := byRevision[attempt.Revision]
		if !exists {
			revisionIndex = len(report.Revisions)
			report.Revisions = append(report.Revisions, historyRevisionUsage{Revision: attempt.Revision})
			byRevision[attempt.Revision] = revisionIndex
			byStage[attempt.Revision] = make(map[string]int)
		}
		revision := &report.Revisions[revisionIndex]
		stageIndex, exists := byStage[attempt.Revision][attempt.Stage]
		if !exists {
			stageIndex = len(revision.Stages)
			revision.Stages = append(revision.Stages, historyStageUsage{Stage: attempt.Stage, Name: historyStageName(attempt.Stage)})
			byStage[attempt.Revision][attempt.Stage] = stageIndex
		}
		stage := &revision.Stages[stageIndex]
		stage.Attempts = append(stage.Attempts, attempt)
		stage.add(attempt)
		revision.add(attempt)
		report.add(attempt)
		report.Hotspots = append(report.Hotspots, attempt.historyHotspot)
	}
	slices.SortStableFunc(report.Hotspots, func(a, b historyHotspot) int {
		switch {
		case a.MS > b.MS:
			return -1
		case a.MS < b.MS:
			return 1
		default:
			return 0
		}
	})
	report.Hotspots = report.Hotspots[:min(3, len(report.Hotspots))]
	return report
}
