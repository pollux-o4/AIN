package editorial

import (
	"bytes"
	"encoding/json"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode/utf16"
)

type draftArtifact struct {
	Revision int64
	Output   draftOutput
}

type draftOutput struct {
	Text    string
	Edits   []json.RawMessage
	hasText bool
}

func (out *draftOutput) UnmarshalJSON(raw []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	var text *string
	if json.Unmarshal(fields["text"], &text) == nil && text != nil {
		out.Text, out.hasText = *text, true
	}
	_ = json.Unmarshal(fields["edits"], &out.Edits)
	return nil
}

type revisionView struct {
	Revision         int64
	Status           *string
	Stage            *string
	CompletionReason *string
	Reviewed         json.RawMessage
	Feedback         *string
	FeedbackSource   *string
	Artifacts        struct{ Draft *draftArtifact }
}

type shownDraft struct {
	text     string
	revision *int64
	edits    []json.RawMessage
}

func (d shownDraft) current(revision int64) bool { return d.revision != nil && *d.revision == revision }

func readDraft(artifact *draftArtifact, revision int64) shownDraft {
	if artifact == nil || !artifact.Output.hasText {
		return shownDraft{}
	}
	if artifact.Revision != 0 {
		revision = artifact.Revision
	}
	return shownDraft{artifact.Output.Text, &revision, artifact.Output.Edits}
}

func (s publicRunState) currentDraft() shownDraft {
	var artifact *draftArtifact
	_ = json.Unmarshal(s.Artifacts["draft"], &artifact)
	return readDraft(artifact, s.Revision)
}

func (s publicRunState) displayedDraft() shownDraft {
	if draft := s.currentDraft(); draft.revision != nil {
		return draft
	}
	for _, prior := range slices.Backward(s.History) {
		if draft := readDraft(prior.Artifacts.Draft, prior.Revision); draft.revision != nil {
			return draft
		}
	}
	return shownDraft{}
}

type previousDraft struct {
	Revision        int64           `json:"revision"`
	Text            string          `json:"text"`
	Status          *string         `json:"status"`
	Stage           *string         `json:"stage"`
	NeedsCompletion bool            `json:"needsCompletion"`
	Reviewed        json.RawMessage `json:"reviewed"`
}

func (s publicRunState) previousDrafts() []previousDraft {
	result := make([]previousDraft, 0, len(s.History))
	for _, prior := range s.History {
		result = append(result, previousDraft{
			Revision: prior.Revision, Text: readDraft(prior.Artifacts.Draft, prior.Revision).text,
			Status: prior.Status, Stage: prior.Stage, Reviewed: prior.Reviewed,
			NeedsCompletion: prior.CompletionReason != nil && *prior.CompletionReason != "",
		})
	}
	return result
}

var titleHeading = regexp.MustCompile(`(?m)^#\s+([^\r\n]+)`)

func displayTitle(idea, draft string) string {
	title, _, _ := strings.Cut(idea, "\n")
	if heading := titleHeading.FindStringSubmatch(draft); len(heading) > 1 {
		title = heading[1]
	}
	if units(title) > 100 {
		title = string(utf16.Decode(utf16.Encode([]rune(title))[:100])) + "…"
	}
	return title
}

// Legacy Node records retain insertion order for operation IDs. Read keys
// alone to avoid publishing signatures.
func publicOperationIDs(raw json.RawMessage) []string {
	numbers, names := []string{}, []string{}
	dec := json.NewDecoder(bytes.NewReader(raw))
	token, err := dec.Token()
	if err != nil || token != json.Delim('{') {
		return names
	}
	for dec.More() {
		token, err := dec.Token()
		if err != nil {
			break
		}
		name, ok := token.(string)
		if !ok {
			break
		}
		if index, err := strconv.ParseUint(name, 10, 32); err == nil && index < 1<<32-1 && strconv.FormatUint(index, 10) == name {
			numbers = append(numbers, name)
		} else {
			names = append(names, name)
		}
		var signature json.RawMessage
		if dec.Decode(&signature) != nil {
			break
		}
	}
	slices.SortFunc(numbers, func(a, b string) int {
		if len(a) != len(b) {
			return len(a) - len(b)
		}
		return strings.Compare(a, b)
	})
	return append(numbers, names...)
}
