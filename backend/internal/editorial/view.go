package editorial

import (
	"context"
	"encoding/json"

	"github.com/pollux-o4/AIN/backend/internal/artifacts"
	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/figureai"
	"github.com/pollux-o4/AIN/backend/internal/figuredomain"
	"github.com/pollux-o4/AIN/backend/internal/writing"
)

const completionNotice = "전체 글쓰기 단계와 결과를 보완해야 합니다. 요구사항 보완을 눌러 주세요."

type publicRunState struct {
	revisionView
	Version           int64
	Idea              string
	Source            string
	Status            string
	Stage             string
	ResumeStatus      string
	Error             *string
	SatisfiedRevision int64
	Artifacts         map[string]json.RawMessage
	History           []revisionView
	Figure            map[string]any
	Direction         map[string]json.RawMessage
	RequirementLog    []requirementEntry
	Brief             map[string]json.RawMessage
	Unmet             []struct{ Message string }
}

type publicRunRecord struct {
	State      publicRunState
	Events     json.RawMessage
	Operations json.RawMessage
	ArchivedAt json.RawMessage
	Issue      *string
	IssueKind  json.RawMessage
	CallsUsed  int64
	MaxCalls   int64
	UpdatedAt  *int64
	QueuedAt   *int64
	StartedAt  *int64
	AI         struct{ Model, Thinking string }
	Pending    *struct{ JobID string }
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
	saved := contract.Run{ID: id, Value: data}
	rules := q.Rules
	if rules == nil {
		rules = writing.NewWithFigures(figuredomain.New())
	}
	var completion *string
	action, err := rules.Next(saved)
	if err != nil {
		return nil, err
	}
	var actionOf struct{ Type string }
	if json.Unmarshal(action.Input, &actionOf) == nil && actionOf.Type == "requirements_required" {
		message := completionNotice
		completion = &message
	}

	state := run.State
	held := writing.OnMigrationHold(run.IssueKind)
	needsCompletion := completion != nil
	monitor, err := q.monitor(ctx, id, run, needsCompletion, held)
	if err != nil {
		return nil, err
	}
	issue := firstDetailIssue(run.Issue, completion, state.Error)
	if held && issue == nil {
		issue = &monitor.Label
	}

	draft := state.displayedDraft()
	title := displayTitle(state.Idea, draft.text)
	presented := state.presented()
	settled := presented && state.Status != "waiting_figure" && state.Status != "paused" && state.Status != "failed"
	available := !needsCompletion && !held
	stageArtifacts, findings := projectArtifacts(state.Artifacts, state.Revision, presented)
	approvals := rules.Approvals(saved)
	requirements := state.standing()
	figures := figuredomain.PublicView(state.Figure, state.Revision, state.currentDraft().text, figureai.EffectiveRoute)
	monitor.Pipeline = pipeline(state, stageArtifacts, monitor.Events, needsCompletion || held)
	metadata := state.editorialMetadata(requirements, presented, draft)
	html, err := artifacts.PreviewRun(saved)
	if err != nil {
		return nil, err
	}

	return json.Marshal(map[string]any{
		"id": id, "version": state.Version, "revision": state.Revision, "idea": state.Idea, "title": title,
		"source": state.Source, "design": metadata.Design, "status": state.Status, "stage": state.Stage,
		"label": monitor.Label, "busy": monitor.Kind == "queued" || monitor.Kind == "working",
		"updatedAt": run.UpdatedAt, "issue": issue, "monitor": monitor,
		"needsCompletion": needsCompletion, "completionReason": completion, "canCompleteRequirements": needsCompletion && !held,
		"text": draft.text, "textRevision": draft.revision, "previous": state.previousDrafts(),
		"findings": findings, "artifacts": stageArtifacts, "model": modelDisplayName(run.AI.Model, run.AI.Thinking),
		"requirements": metadata.Requirements, "brief": metadata.Brief, "changes": metadata.Changes,
		"unmetRequirements": metadata.Unmet,
		"canDownload":       draft.text != "" && (!draft.current(state.Revision) || presented || needsCompletion),
		"canFeedback":       settled && available, "canApproveBrief": state.Status == "awaiting_brief" && available,
		"figure": figures, "canRequestFigures": state.Status == "satisfied" && state.Figure == nil && available,
		"canSelectFigures":  state.Status == "awaiting_figure_choice" && available,
		"canApproveDesign":  state.Status == "awaiting_figure_design" && available,
		"canConfirmFigures": state.Status == "awaiting_figure_review" && available,
		"canReviseFigures":  state.Status == "awaiting_figure_review" && available,
		"canDiscardFigures": state.Figure != nil && settled && state.Status != "publication_ready" && !held,
		"canSatisfy":        approvals.Satisfy && available, "canAuthorizePublication": approvals.Authorize && available,
		"callsUsed": run.CallsUsed, "maxCalls": run.MaxCalls, "appliedOperations": publicOperationIDs(run.Operations),
		"archived": isArchived(run.ArchivedAt), "html": html,
	})
}

func (s publicRunState) presented() bool {
	return s.Status == "awaiting_user" || s.Status == "satisfied" || s.Status == "publication_ready" ||
		s.Figure != nil && s.SatisfiedRevision == s.Revision
}

func firstDetailIssue(values ...*string) *string {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func modelDisplayName(model, thinking string) string {
	switch model {
	case "gemini-4-hydrogen":
		switch thinking {
		case "medium":
			return "Hydrogen 4 Medium"
		case "high":
			return "Hydrogen 4 High"
		}
	case "gemini-4-hydrogen-medium":
		return "Hydrogen 4 Medium"
	case "gemini-4-hydrogen-high":
		return "Hydrogen 4 High"
	}
	return model
}
