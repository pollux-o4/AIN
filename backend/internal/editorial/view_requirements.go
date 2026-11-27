package editorial

import (
	"encoding/json"
	"fmt"
	"slices"

	"github.com/pollux-o4/AIN/backend/internal/writing"
)

type requirementChange struct {
	Kind  string
	Op    string
	Value json.RawMessage
}

type requirementEntry struct {
	Changes []requirementChange
}

func (s publicRunState) standing() []requirementChange {
	result := []requirementChange{}
	if s.RequirementLog == nil {
		for _, kind := range []string{"mode", "readerLevel"} {
			value := s.Direction[kind]
			if text := rawText(value); text != nil && *text != "" && *text != "auto" {
				result = append(result, requirementChange{Kind: kind, Value: value})
			}
		}
		length := s.Direction["targetLength"]
		if len(length) == 0 || string(length) == "null" {
			history := []map[string]*string{}
			for _, prior := range s.History {
				history = append(history, map[string]*string{"feedback": prior.Feedback, "feedbackSource": prior.FeedbackSource})
			}
			length = writing.LegacyLengthFromState(map[string]json.RawMessage{
				"feedback": encodedDetail(s.Feedback), "feedbackSource": encodedDetail(s.FeedbackSource),
				"idea": encodedDetail(s.Idea), "brief": encodedDetail(s.Brief), "history": encodedDetail(history),
			})
		}
		if len(length) != 0 {
			result = append(result, requirementChange{Kind: "length", Value: length})
		}
		return result
	}
	for _, entry := range s.RequirementLog {
		for _, change := range entry.Changes {
			at := slices.IndexFunc(result, func(before requirementChange) bool { return before.Kind == change.Kind })
			switch {
			case change.Op == "lift":
				if at >= 0 {
					result = slices.Delete(result, at, at+1)
				}
			case at >= 0:
				result[at] = change
			default:
				result = append(result, change)
			}
		}
	}
	return result
}

type editorialMetadata struct {
	Design       designView
	Requirements []string
	Brief        map[string]json.RawMessage
	Changes      []json.RawMessage
	Unmet        []string
}

type designView struct {
	Mode        *string         `json:"mode"`
	ModeBy      *string         `json:"modeBy"`
	ReaderLevel *string         `json:"readerLevel"`
	LevelBy     *string         `json:"levelBy"`
	Sections    []designSection `json:"sections"`
}

type designSection struct {
	Title string  `json:"title"`
	Mode  *string `json:"mode"`
}

func (s publicRunState) editorialMetadata(requirements []requirementChange, presented bool, draft shownDraft) editorialMetadata {
	meta := editorialMetadata{
		Design: s.design(requirements), Requirements: []string{}, Changes: []json.RawMessage{}, Unmet: []string{},
	}
	for _, change := range requirements {
		meta.Requirements = append(meta.Requirements, describeRequirement(change))
	}
	if s.Brief != nil {
		meta.Brief = make(map[string]json.RawMessage, len(s.Brief)+1)
		for key, raw := range s.Brief {
			meta.Brief[key] = raw
		}
		var changes []requirementChange
		_ = json.Unmarshal(s.Brief["requirementChanges"], &changes)
		formatted := make([]string, 0, len(changes))
		for _, change := range changes {
			formatted = append(formatted, describeRequirement(change))
		}
		meta.Brief["requirementChanges"] = encodedDetail(formatted)
	}
	if draft.current(s.Revision) && draft.edits != nil {
		meta.Changes = draft.edits
	}
	if presented {
		for _, entry := range s.Unmet {
			meta.Unmet = append(meta.Unmet, entry.Message)
		}
	}
	return meta
}

func (s publicRunState) design(requirements []requirementChange) designView {
	diagnosis := s.currentArtifact("diagnose")
	outline := s.currentArtifact("outline")
	mode, modeBy := designValue("mode", diagnosis["primaryMode"], requirements)
	level, levelBy := designValue("readerLevel", diagnosis["readerLevel"], requirements)
	result := designView{Mode: mode, ModeBy: modeBy, ReaderLevel: level, LevelBy: levelBy, Sections: []designSection{}}
	var sections []json.RawMessage
	_ = json.Unmarshal(outline["sections"], &sections)
	for _, row := range sections {
		if title := rawText(row); title != nil {
			result.Sections = append(result.Sections, designSection{Title: *title})
			continue
		}
		var card struct {
			Title string
			Mode  *string
		}
		_ = json.Unmarshal(row, &card)
		if card.Mode != nil && !slices.Contains([]string{"explain", "procedure", "argue", "narrate"}, *card.Mode) {
			card.Mode = nil
		}
		result.Sections = append(result.Sections, designSection{Title: card.Title, Mode: card.Mode})
	}
	return result
}

func (s publicRunState) currentArtifact(stage string) map[string]json.RawMessage {
	var artifact artifactView
	if json.Unmarshal(s.Artifacts[stage], &artifact) == nil && artifact.Revision == s.Revision {
		return artifact.Output
	}
	return nil
}

func designValue(kind string, ai json.RawMessage, requirements []requirementChange) (*string, *string) {
	for _, change := range requirements {
		if change.Kind == kind {
			if value := rawText(change.Value); value != nil {
				by := "user"
				return value, &by
			}
		}
	}
	if value := rawText(ai); value != nil {
		by := "ai"
		return value, &by
	}
	return nil, nil
}

func describeRequirement(change requirementChange) string {
	label := change.Kind
	switch change.Kind {
	case "length":
		label = "분량"
	case "mode":
		label = "서술 방식"
	case "readerLevel":
		label = "독자 수준"
	}
	if change.Op == "lift" {
		return label + ": 제한 해제"
	}
	if change.Kind == "length" {
		var length struct {
			Min int64
			Max *int64
		}
		if json.Unmarshal(change.Value, &length) == nil {
			if length.Max == nil {
				return fmt.Sprintf("%s: %d자 이상", label, length.Min)
			}
			return fmt.Sprintf("%s: %d~%d자", label, length.Min, *length.Max)
		}
	}
	if text := rawText(change.Value); text != nil {
		return label + ": " + *text
	}
	return label + ": " + string(change.Value)
}

func rawText(raw json.RawMessage) *string {
	var text *string
	if json.Unmarshal(raw, &text) != nil {
		return nil
	}
	return text
}

func encodedDetail(value any) json.RawMessage {
	raw, _ := json.Marshal(value)
	return raw
}
