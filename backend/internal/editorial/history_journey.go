package editorial

import (
	"encoding/json"
	"slices"
	"strings"
)

type historyOutput map[string]json.RawMessage

type historyArtifact struct {
	Revision int64
	Output   historyOutput
}

type historySnapshot struct {
	Revision  int64
	Feedback  *string
	Artifacts map[string]historyArtifact
}

func (s historySnapshot) artifact(stage string) historyOutput {
	return s.Artifacts[stage].Output
}

func (s historySnapshot) current(stage string) historyOutput {
	if item := s.Artifacts[stage]; item.Revision == s.Revision {
		return item.Output
	}
	return nil
}

type journeyChoice struct {
	Label  string  `json:"label"`
	Text   string  `json:"text"`
	Reason *string `json:"reason"`
}
type journeyRow struct {
	Revision  int64           `json:"revision"`
	Request   *string         `json:"request"`
	Direction []journeyChoice `json:"direction"`
	Summary   *string         `json:"summary"`
	Findings  []string        `json:"findings"`
	HasDraft  bool            `json:"hasDraft"`
}

func rawString(raw json.RawMessage) *string {
	var value *string
	if json.Unmarshal(raw, &value) != nil {
		return nil
	}
	return value
}

func directionForHistory(snapshot historySnapshot) []journeyChoice {
	audience, topic, value, outline := snapshot.current("audience"), snapshot.current("topic"), snapshot.current("value"), snapshot.current("outline")
	var sections []json.RawMessage
	_ = json.Unmarshal(outline["sections"], &sections)
	titles := make([]string, 0, len(sections))
	for _, section := range sections {
		if label := rawString(section); label != nil {
			titles = append(titles, *label)
		} else {
			var card struct{ Title string }
			_ = json.Unmarshal(section, &card)
			titles = append(titles, card.Title)
		}
	}
	key := rawString(value["outcome"])
	if key == nil {
		key = rawString(topic["problem"])
	}
	direction := make([]journeyChoice, 0, 3)
	for _, choice := range []journeyChoice{
		{"독자", stringValue(rawString(audience["reader"])), rawString(audience["intent"])},
		{"핵심", stringValue(key), rawString(topic["scope"])},
		{"구성", strings.Join(titles, " → "), rawString(outline["rationale"])},
	} {
		if strings.TrimSpace(choice.Text) != "" {
			direction = append(direction, choice)
		}
	}
	return direction
}

func sameChoice(a, b journeyChoice) bool {
	if a.Label != b.Label || a.Text != b.Text {
		return false
	}
	return a.Reason == nil && b.Reason == nil ||
		a.Reason != nil && b.Reason != nil && *a.Reason == *b.Reason
}

func historyFindings(review, research historyOutput) []string {
	findings := []string{}
	seen := make(map[string]bool)
	for _, raw := range []json.RawMessage{review["findings"], research["uncertainties"]} {
		var items []json.RawMessage
		_ = json.Unmarshal(raw, &items)
		for _, item := range items {
			value := stringValue(rawString(item))
			if strings.TrimSpace(value) != "" && !seen[value] {
				findings = append(findings, value)
				seen[value] = true
			}
		}
	}
	return findings
}

func projectHistoryJourney(snapshots []historySnapshot, records []historyRecord) []journeyRow {
	requests := make(map[int64]historyRecord)
	for _, record := range records {
		if record.Kind == "feedback" || record.Kind == "complete_requirements" {
			if _, exists := requests[record.Revision]; !exists {
				requests[record.Revision] = record
			}
		}
	}
	rows := make([]journeyRow, 0, len(snapshots))
	var before []journeyChoice
	var previousFeedback *string
	for _, snapshot := range snapshots {
		if snapshot.Revision < 1 {
			continue
		}
		direction := directionForHistory(snapshot)
		delta := make([]journeyChoice, 0, len(direction))
		for _, choice := range direction {
			if !slices.ContainsFunc(before, func(old journeyChoice) bool { return sameChoice(choice, old) }) {
				delta = append(delta, choice)
			}
		}
		var request *string
		if snapshot.Revision > 1 {
			event, present := requests[snapshot.Revision]
			request = event.Reason
			if request == nil {
				request = previousFeedback
			}
			if request == nil && present {
				request = &event.Label
			}
		}
		rows = append(rows, journeyRow{
			Revision: snapshot.Revision, Request: request, Direction: delta,
			Summary:  rawString(snapshot.current("draft")["changeSummary"]),
			Findings: historyFindings(snapshot.current("review"), snapshot.current("research")),
			HasDraft: stringValue(rawString(snapshot.artifact("draft")["text"])) != "",
		})
		before, previousFeedback = direction, snapshot.Feedback
	}
	return rows
}
