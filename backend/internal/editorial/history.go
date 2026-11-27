package editorial

import (
	"context"
	"encoding/json"
	"strconv"

	"github.com/pollux-o4/AIN/backend/internal/sessions"
)

var historyGoals = map[string]string{
	"diagnose":       "글의 목적·독자·문체와 작성 방향을 정합니다.",
	"topic":          "다룰 문제와 주제의 범위를 정합니다.",
	"audience":       "대상 독자와 독자가 얻고 싶은 것을 정합니다.",
	"value":          "글이 전달할 가치와 유지할 내용을 정합니다.",
	"research":       "근거·출처와 추가 확인이 필요한 내용을 정리합니다.",
	"outline":        "글의 구성과 전개 순서를 정합니다.",
	"draft":          "앞 단계의 결과와 사용자 요구를 반영해 본문을 작성합니다.",
	"review":         "본문의 오류·근거·원문 보존 여부를 검토합니다.",
	"route":          "수정 의견을 반영할 시작 단계를 선택합니다.",
	"figure_plan":    "확정된 초안에서 시각자료가 도울 위치와 보여줄 주장을 제안합니다.",
	"figure_compose": "고른 위치 전부에 어떤 장면을 어떻게 그릴지 한 번에 정합니다.",
	"figure":         "선택한 위치에 놓을 시각자료를 만듭니다. 본문은 바꾸지 않습니다.",
}

func historyStageName(stage string) string {
	for _, item := range writingStages {
		if item.key == stage {
			return item.name
		}
	}
	switch stage {
	case "route":
		return "수정 위치 확인"
	case "figure_plan":
		return "시각자료 위치 제안"
	case "figure_compose":
		return "시각자료 구성"
	case "figure":
		return "시각자료 생성"
	default:
		return stage
	}
}

type historyEvent struct {
	At          int64
	Kind        string
	Label       string
	Revision    int64
	Stage       string
	JobID       *string
	Reason      *string
	ExecutionID *string
}

type historyRecord struct {
	Key          string          `json:"key"`
	At           int64           `json:"at"`
	Kind         string          `json:"kind"`
	Label        string          `json:"label"`
	Revision     int64           `json:"revision"`
	Stage        string          `json:"stage"`
	Name         string          `json:"name"`
	Goal         string          `json:"goal"`
	Inputs       []string        `json:"inputs"`
	InputsSource string          `json:"inputsSource"`
	Model        *string         `json:"model"`
	ExecutionID  *string         `json:"executionId"`
	Output       historyOutput   `json:"output"`
	ResultSource string          `json:"resultSource"`
	Target       *string         `json:"target"`
	Reason       *string         `json:"reason"`
	Unavailable  bool            `json:"unavailable"`
	Steps        []sessions.Step `json:"steps"`
}

func (q Queries) HistoryView(ctx context.Context, id string) (json.RawMessage, error) {
	data, err := q.Run(ctx, id)
	if err != nil {
		return nil, err
	}
	var saved struct {
		State struct {
			historySnapshot
			History []historySnapshot
		}
		Events []historyEvent
	}
	if err := json.Unmarshal(data, &saved); err != nil {
		return nil, err
	}
	jobs, err := readHistoryJobs(ctx, q.Store, saved.Events)
	if err != nil {
		return nil, err
	}
	snapshots := append(saved.State.History, saved.State.historySnapshot)
	retained := make(map[int64]historySnapshot, len(snapshots))
	for _, snapshot := range snapshots {
		retained[snapshot.Revision] = snapshot
	}
	records := historyRecords(saved.Events, jobs, retained)
	return json.Marshal(map[string]any{
		"records": records,
		"journey": projectHistoryJourney(snapshots, records),
		"usage":   projectHistoryUsage(saved.Events, jobs, q.now().UnixMilli()),
	})
}

func historyRecords(events []historyEvent, jobs map[string]*historyJob, snapshots map[int64]historySnapshot) []historyRecord {
	records := make([]historyRecord, len(events))
	feedback := make(map[int64]*string)
	for index := len(events) - 1; index >= 0; index-- {
		event := events[index]
		job := jobs[stringValue(event.JobID)]
		rec := historyRecord{
			Key: strconv.Itoa(index), At: event.At, Kind: event.Kind, Label: event.Label,
			Revision: event.Revision, Stage: event.Stage, Name: historyStageName(event.Stage),
			Inputs: []string{}, InputsSource: "unavailable", ResultSource: "none",
			ExecutionID: event.ExecutionID, Reason: event.Reason,
			Unavailable: stringValue(event.JobID) != "" && job == nil, Steps: []sessions.Step{},
		}
		completed := event.Kind == "ai_completed"
		if completed || event.Kind == "ai_requested" {
			rec.Goal = historyGoals[event.Stage]
		}
		if job == nil {
			if completed {
				rec.Output = savedHistoryOutput(snapshots[event.Revision].artifact(event.Stage), event.Stage)
				if rec.Output != nil {
					rec.ResultSource = "artifact"
				}
			}
		} else {
			rec.Model, rec.Inputs, rec.InputsSource = job.Model, job.Inputs.labels(), "reconstructed"
			if job.InputsRecorded {
				rec.InputsSource = "recorded"
			}
			if completed {
				rec.Output = job.Output
				if job.Output != nil {
					rec.ResultSource = "job"
				}
				if stringValue(job.Target) != "" {
					target := historyStageName(*job.Target)
					rec.Target = &target
				}
				if rec.Reason == nil {
					rec.Reason = job.Reason
				}
			}
			if completed || event.Kind == "ai_requested" && job.Status == "failed" {
				rec.Steps = job.Steps
			}
		}
		if rec.Reason == nil && event.Kind == "feedback" {
			rec.Reason = feedback[event.Revision]
		}
		if rec.Reason == nil && job != nil && job.Status == "failed" {
			rec.Reason = historyFailure(job.FailureKind)
		}
		if job != nil && stringValue(job.Feedback) != "" {
			feedback[event.Revision] = job.Feedback
		}
		records[index] = rec
	}
	return records
}

func stringValue(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func historyFailure(kind string) *string {
	reason := map[string]string{
		"timeout":        "AI 실행 제한 시간을 넘겼습니다.",
		"cancelled":      "AI 실행이 중단됐습니다.",
		"usage_limit":    "AI 사용 한도에 도달했습니다. 한도가 회복된 뒤 다시 시도해 주세요.",
		"authentication": "AI 제공자 로그인이 필요합니다.",
		"provider_error": "AI 제공자가 오류를 반환했습니다.",
		"invalid_output": "AI 응답이 약속한 결과 형식과 달라 쓰지 못했습니다.",
	}[kind]
	if reason == "" {
		reason = "AI 응답을 편집 결과로 확정하지 못했습니다."
	}
	return &reason
}
