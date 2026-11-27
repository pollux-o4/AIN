package editorial

import (
	"context"
	"encoding/json"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/pollux-o4/AIN/backend/internal/sessions"
	"github.com/pollux-o4/AIN/backend/internal/store"
)

type historyJobReader interface {
	LegacyJob(context.Context, string) (store.LegacyJob, error)
}

type historySection struct {
	Index int64 `json:"index"`
	Total int64 `json:"total"`
}
type historyFigure struct {
	ID   string `json:"id"`
	Pass string `json:"pass,omitempty"`
}

type historyJob struct {
	Model, Feedback, Target, Reason *string
	Status, FailureKind             string
	Inputs                          historyInputs
	InputsRecorded                  bool
	Output                          historyOutput
	Steps                           []sessions.Step
	Section                         *historySection
	Figure                          *historyFigure
	Tokens                          *int64
	Chars                           *int64
}

type historyInputs struct {
	Source, Feedback, Baseline bool
	Stages                     []string
}

func (i historyInputs) labels() []string {
	labels := []string{"글감"}
	if i.Source {
		labels = append(labels, "참고 자료")
	}
	if i.Feedback {
		labels = append(labels, "수정 의견")
	}
	for _, stage := range i.Stages {
		if _, known := historyGoals[stage]; known {
			labels = append(labels, historyStageName(stage)+" 결과")
		}
	}
	if i.Baseline {
		labels = append(labels, "이전 회차의 해당 단계 결과")
	}
	return labels
}

type legacyHistoryFields struct {
	Kind, Status, FailureKind string
	ProviderModel             *string
	InputSummary              *historyInputs
	Usage                     *struct{ InputTokens, OutputTokens int64 }
	Steps                     []sessions.Step
	Action                    struct {
		Type, Stage, Mode, FigureID, Pass string
		FigureIDs                         []string
		Feedback                          *string
		Rejected                          json.RawMessage
		Section                           *struct {
			historySection
			Rejected json.RawMessage
		}
	}
	Event struct {
		Output         historyOutput
		Target, Reason *string
	}
	State struct {
		historySnapshot
		Source      string
		RouteTarget *string
		History     []historySnapshot
	}
}

var historyMarkdownLink = regexp.MustCompile(`\]\([^)]*\)`)

func readHistoryJobs(ctx context.Context, source RunReader, events []historyEvent) (map[string]*historyJob, error) {
	results := make(map[string]*historyJob)
	reader, ok := source.(historyJobReader)
	if !ok {
		return results, nil
	}
	var job func(string, int) *historyJob
	job = func(id string, depth int) *historyJob {
		if id == "" || depth > 4 || ctx.Err() != nil {
			return nil
		}
		if result, exists := results[id]; exists {
			return result
		}
		// A missing record, malformed record, or cycle is unavailable, never a reason to rerun.
		results[id] = nil
		stored, err := reader.LegacyJob(ctx, id)
		if err != nil {
			return nil
		}
		var fields legacyHistoryFields
		if json.Unmarshal(stored.Value, &fields) != nil {
			return nil
		}
		var result *historyJob
		if fields.Kind == "batch" {
			children := make([]*historyJob, 0, len(stored.Parts))
			for _, part := range stored.Parts {
				child := job(part, depth+1)
				if child == nil {
					return nil
				}
				children = append(children, child)
			}
			result = batchHistoryJob(fields, children)
		} else {
			result = projectHistoryJob(fields)
		}
		results[id] = result
		return result
	}
	for _, event := range events {
		job(stringValue(event.JobID), 0)
	}
	return results, ctx.Err()
}

func batchHistoryJob(fields legacyHistoryFields, children []*historyJob) *historyJob {
	if len(children) == 0 {
		return nil
	}
	projected := *children[0]
	projected.Status, projected.FailureKind = fields.Status, fields.FailureKind
	projected.Output, projected.Tokens = nil, nil
	projected.Steps = []sessions.Step{}
	projected.Figure = &historyFigure{ID: strings.Join(fields.Action.FigureIDs, ","), Pass: fields.Action.Pass}
	for _, child := range children {
		projected.Tokens = sumHistoryTokens(projected.Tokens, child.Tokens)
		projected.Steps = append(projected.Steps, child.Steps...)
	}
	return &projected
}

func projectHistoryJob(fields legacyHistoryFields) *historyJob {
	stage := fields.Action.Stage
	if stage == "" {
		stage = "route"
	}
	if _, supported := historyGoals[stage]; !supported {
		return nil
	}
	feedback := fields.State.Feedback
	if fields.Action.Type == "request_figure" {
		feedback = fields.Action.Feedback
	}
	job := &historyJob{
		Model: fields.ProviderModel, Status: fields.Status, FailureKind: fields.FailureKind, Target: fields.Event.Target,
		Reason: fields.Event.Reason, Feedback: feedback, Steps: publicHistorySteps(fields.Steps),
	}
	job.InputsRecorded = fields.InputSummary != nil
	if job.InputsRecorded {
		job.Inputs = *fields.InputSummary
	} else {
		job.Inputs = reconstructHistoryInputs(fields, stage, feedback)
	}
	if fields.Event.Output != nil {
		job.Output = projectedHistoryOutput(fields.Event.Output, stage, false)
		if text := rawString(fields.Event.Output["text"]); text != nil {
			chars := int64(utf8.RuneCountInString(historyMarkdownLink.ReplaceAllString(*text, "]")))
			job.Chars = &chars
		}
	}
	if fields.Usage != nil {
		sum := fields.Usage.InputTokens + fields.Usage.OutputTokens
		job.Tokens = &sum
	}
	if fields.Action.Section != nil {
		job.Section = &fields.Action.Section.historySection
	}
	if fields.Action.FigureID != "" {
		job.Figure = &historyFigure{ID: fields.Action.FigureID, Pass: fields.Action.Pass}
	}
	return job
}

var historyStageInputs = map[string][]string{
	"diagnose": {},
	"topic":    {"diagnose"},
	"audience": {"diagnose", "topic"},
	"value":    {"diagnose", "topic", "audience"},
	"research": {"diagnose", "topic", "audience", "value"},
	"outline":  {"diagnose", "topic", "audience", "value", "research"},
	"draft":    {"diagnose", "topic", "audience", "value", "research", "outline"},
	"review":   {"diagnose", "audience", "value", "research", "outline", "draft"},
}

func reconstructHistoryInputs(fields legacyHistoryFields, stage string, feedback *string) historyInputs {
	r := historyInputs{Feedback: stringValue(feedback) != ""}
	if fields.Action.Type == "request_figure" {
		r.Stages = []string{"audience", "value", "outline", "draft"}
		return r
	}
	r.Source = fields.State.Source != ""
	stages := historyStageInputs[stage]
	if fields.Action.Type == "request_route" || stage == "route" {
		stages = make([]string, 0, len(writingStages))
		for _, item := range writingStages {
			stages = append(stages, item.key)
		}
	}
	for _, prerequisite := range stages {
		if _, present := fields.State.Artifacts[prerequisite]; present {
			r.Stages = append(r.Stages, prerequisite)
		}
	}
	if len(fields.State.History) > 0 {
		last := fields.State.History[len(fields.State.History)-1]
		edit := stage
		if fields.State.RouteTarget != nil {
			edit = *fields.State.RouteTarget
		}
		switch {
		case fields.Action.Mode == "edit":
			r.Baseline = stringValue(rawString(last.artifact("draft")["text"])) != ""
		case stage != "route" && stage != "review" && stage == edit && r.Feedback:
			r.Baseline = last.artifact(stage) != nil
			if fields.Action.Section != nil {
				r.Baseline = hasHistoryPart(stringValue(rawString(last.artifact("draft")["text"])), fields.Action.Section.historySection)
			}
		}
	}
	rejected := fields.Action.Rejected
	if fields.Action.Section != nil {
		rejected = fields.Action.Section.Rejected
	}
	r.Baseline = r.Baseline || stringValue(rawString(rejected)) != ""
	return r
}

var historyHeading = regexp.MustCompile(`(?m)^##[\t\p{Zs}]`)

func hasHistoryPart(text string, section historySection) bool {
	if text == "" || section.Index < 0 || section.Index >= section.Total {
		return false
	}
	starts := historyHeading.FindAllStringIndex(text, -1)
	lead := text
	sections := make([]string, 0, len(starts))
	if len(starts) > 0 {
		lead = text[:starts[0][0]]
	}
	for index, start := range starts {
		end := len(text)
		if index+1 < len(starts) {
			end = starts[index+1][0]
		}
		part := text[start[0]:end]
		header, _, _ := strings.Cut(part, "\n")
		if index > 0 && strings.TrimSpace(header) == "## 한눈에 정리" {
			break
		}
		sections = append(sections, part)
	}
	if int64(len(sections)) == section.Total {
		return true
	}
	return int64(len(sections))+1 == section.Total && (section.Index > 0 || strings.TrimSpace(lead) != "")
}

func publicHistorySteps(saved []sessions.Step) []sessions.Step {
	result := make([]sessions.Step, 0, len(saved))
	for _, step := range saved {
		switch step.Kind {
		case "note":
			note := strings.TrimSpace(step.Text)
			jsonText := strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(note, "```"), "json"))
			if note == "" || strings.HasPrefix(jsonText, "{") || strings.HasPrefix(jsonText, "[") {
				continue
			}
			step.Status = ""
		case "tool":
			if !slices.Contains([]string{"명령 실행", "파일 수정", "자료 읽기", "자료 찾기", "웹 확인", "도구 실행"}, step.Text) {
				step.Text = "도구 실행"
			}
			if step.Status != "completed" && step.Status != "failed" {
				step.Status = "running"
			}
		default:
			continue
		}
		result = append(result, step)
	}
	return result
}
