package editorial

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/artifacts"
	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/writing"
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
		Stage             string
		SatisfiedRevision int64
		Artifacts         map[string]json.RawMessage
		History           []revisionView
	}
	Events     json.RawMessage
	Operations map[string]string
	ArchivedAt json.RawMessage
	Issue      *string
	IssueKind  json.RawMessage
	CallsUsed  int64
	MaxCalls   int64
	UpdatedAt  *int64
	Worker     struct {
		ConfirmedAt *int64
		ExecutionID *string
	}
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
		revision := draft.Revision
		if revision == 0 {
			revision = s.Revision
		}
		textRevision = &revision
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
	held := writing.OnMigrationHold(run.IssueKind)
	pending := isPending(s.Status) && !held
	label := stateLabel(s.Status)
	if held {
		label = "이전 AI 작업 확인 대기"
		if run.Issue == nil {
			run.Issue = &label
		}
	}
	events := publicEvents(run.Events)
	kind := "ready"
	switch {
	case held:
		kind = "blocked"
	case s.Status == "paused" || s.Status == "failed":
		kind = s.Status
	case run.Issue != nil:
		kind = "blocked"
	case pending:
		kind = "queued"
	}
	presented := s.Status == "awaiting_user" || s.Status == "satisfied" || s.Status == "publication_ready"
	stageArtifacts, findings := projectArtifacts(s.Artifacts, s.Revision, presented)
	saved := contract.Run{ID: id, Value: data}
	rules := q.Rules
	if rules == nil {
		rules = writing.New()
	}
	approvals := rules.Approvals(saved)
	html, err := artifacts.PreviewRun(saved)
	if err != nil {
		return nil, err
	}
	return json.Marshal(map[string]any{
		"id": id, "version": s.Version, "revision": s.Revision, "idea": s.Idea, "title": title,
		"source": s.Source, "status": s.Status, "stage": s.Stage, "label": label, "busy": kind == "queued" || kind == "working", "updatedAt": run.UpdatedAt, "issue": run.Issue, "text": text, "textRevision": textRevision,
		"previous": previous, "findings": findings, "artifacts": stageArtifacts, "model": "",
		"needsCompletion": false, "completionReason": nil, "canCompleteRequirements": false,
		"canDownload": text != "" && presented, "canFeedback": presented,
		"canSatisfy": approvals.Satisfy, "canAuthorizePublication": approvals.Authorize,
		"callsUsed": run.CallsUsed, "maxCalls": run.MaxCalls, "appliedOperations": operations,
		"archived": isArchived(run.ArchivedAt),
		"html":     html,
		"monitor": map[string]any{
			"kind": kind, "label": label, "now": time.Now().UnixMilli(),
			"lastConfirmedAt": run.Worker.ConfirmedAt, "executionId": run.Worker.ExecutionID, "canPause": pending, "canResume": !held && (s.Status == "paused" || s.Status == "failed"),
			"resumeLabel": "이어가기", "needsAiAttention": false, "events": events, "pipeline": pipeline(s.Stage, s.Status, s.Revision, stageArtifacts, events),
		},
	})
}
