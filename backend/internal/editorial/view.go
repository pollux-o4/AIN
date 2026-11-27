package editorial

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/artifacts"
	"github.com/pollux-o4/AIN/backend/internal/contract"
)

type draftArtifact struct {
	Revision int64
	Output   struct {
		Text  string
		Edits []json.RawMessage
	}
}

type revisionView struct {
	Revision  int64
	Artifacts struct{ Draft *draftArtifact }
}

type publicRunRecord struct {
	State struct {
		revisionView
		Version           int64
		Idea              string
		Source            string
		Status            string
		SatisfiedRevision int64
		Artifacts         map[string]json.RawMessage
		History           []revisionView
	}
	Operations map[string]string
	ArchivedAt json.RawMessage
	Issue      *string
	CallsUsed  int64
	MaxCalls   int64
}

func (q Queries) RunView(ctx context.Context, id string) (json.RawMessage, error) {
	data, err := q.Run(ctx, id)
	if err != nil {
		return nil, err
	}
	var run publicRunRecord
	if err := json.Unmarshal(data, &run); err != nil {
		return nil, err
	}

	s := run.State
	var draft *draftArtifact
	_ = json.Unmarshal(s.Artifacts["draft"], &draft)
	previous := make([]map[string]any, 0, len(s.History))
	for _, version := range s.History {
		text := ""
		if old := version.Artifacts.Draft; old != nil {
			text = old.Output.Text
		}
		previous = append(previous, map[string]any{"revision": version.Revision, "text": text})
	}
	if draft == nil {
		for i := len(s.History) - 1; i >= 0; i-- {
			if draft = s.History[i].Artifacts.Draft; draft != nil {
				break
			}
		}
	}
	title, _, _ := strings.Cut(s.Idea, "\n")
	var text string
	var textRevision *int64
	if draft != nil {
		text = draft.Output.Text
		textRevision = &draft.Revision
		for line := range strings.SplitSeq(text, "\n") {
			if heading, ok := strings.CutPrefix(line, "# "); ok && strings.TrimSpace(heading) != "" {
				title = heading
				break
			}
		}
	}
	operations := make([]string, 0, len(run.Operations))
	for id := range run.Operations {
		operations = append(operations, id)
	}
	sort.Strings(operations)
	pending := s.Status == "waiting_ai" || s.Status == "waiting_route" || s.Status == "waiting_figure"
	presented := s.Status == "awaiting_user" || s.Status == "satisfied" || s.Status == "publication_ready"
	stageArtifacts, findings := projectArtifacts(s.Artifacts, s.Revision, presented)
	html, err := artifacts.PreviewRun(contract.Run{ID: id, Value: data})
	if err != nil {
		return nil, err
	}
	return json.Marshal(map[string]any{
		"id": id, "version": s.Version, "revision": s.Revision, "idea": s.Idea, "title": title,
		"source": s.Source, "status": s.Status, "issue": run.Issue, "text": text, "textRevision": textRevision,
		"previous": previous, "findings": findings, "artifacts": stageArtifacts, "model": "",
		"needsCompletion": false, "completionReason": nil, "canCompleteRequirements": false,
		"canDownload": text != "" && presented, "canFeedback": presented,
		"canSatisfy": false, "canAuthorizePublication": false,
		"callsUsed": run.CallsUsed, "maxCalls": run.MaxCalls, "appliedOperations": operations,
		"archived": len(run.ArchivedAt) > 0 && string(run.ArchivedAt) != "null",
		"html":     html,
		"monitor": map[string]any{
			"kind": s.Status, "label": stateLabel(s.Status), "now": time.Now().UnixMilli(),
			"lastConfirmedAt": nil, "canPause": pending, "canResume": s.Status == "paused" || s.Status == "failed",
			"resumeLabel": "이어가기", "needsAiAttention": false, "events": []any{}, "pipeline": []any{},
		},
	})
}
