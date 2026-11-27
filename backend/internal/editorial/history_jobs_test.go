package editorial

import (
	"bytes"
	"context"
	"encoding/json"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/store"
)

type historyFixtureReader struct {
	run   json.RawMessage
	jobs  map[string]store.LegacyJob
	reads []string
}

func (f *historyFixtureReader) GetRun(context.Context, string) (contract.Run, error) {
	return contract.Run{ID: "fixture", Value: f.run}, nil
}

func (f *historyFixtureReader) ListSummaries(context.Context, func(contract.RunSummary) error) error {
	return nil
}

func (f *historyFixtureReader) LegacyJob(_ context.Context, id string) (store.LegacyJob, error) {
	f.reads = append(f.reads, id)
	if job, exists := f.jobs[id]; exists {
		return job, nil
	}
	return store.LegacyJob{}, contract.ErrNotFound
}

func TestSavedHistoryBatchAndPrivateFields(t *testing.T) {
	const hidden = "SYNTHETIC_PRIVATE_JOB_DATA"
	source := &historyFixtureReader{
		run: json.RawMessage(`{"state":{"revision":1},"events":[
			{"kind":"ai_requested","stage":"figure","revision":1,"at":100,"label":"묶음 요청","jobId":"parent"},
			{"kind":"ai_completed","stage":"figure","revision":1,"at":150,"label":"묶음 완료","jobId":"parent"},
			{"kind":"ai_requested","stage":"figure","revision":1,"at":200,"label":"그림 요청","jobId":"f1"},
			{"kind":"ai_completed","stage":"figure","revision":1,"at":230,"label":"그림 완료","jobId":"f1"}
		]}`),
		jobs: map[string]store.LegacyJob{
			"parent": {
				Value: json.RawMessage(`{"kind":"batch","status":"completed","action":{"stage":"figure","figureIds":["f1","f2"],"pass":"draw"}}`),
				Parts: []string{"f1", "f2"},
			},
			"f1": {
				Value: json.RawMessage(`{"status":"completed","providerModel":"fixture/model","action":{"type":"request_figure","stage":"figure","figureId":"f1","pass":"draw"},"inputSummary":{"stages":["draft"]},"usage":{"inputTokens":4,"outputTokens":2,"cachedInputTokens":3},"event":{"output":{"figures":[{"alt":"공개 설명","svg":"` + hidden + `"}],"diagnostic":"` + hidden + `"}},"steps":[{"kind":"tool","text":"자료 읽기","status":"completed","at":120,"details":"` + hidden + `"},{"kind":"note","text":"{\"diagnostic\":\"` + hidden + `\"}","at":130}]}`),
			},
			"f2": {
				Value: json.RawMessage(`{"status":"completed","providerModel":"fixture/model","action":{"type":"request_figure","stage":"figure","figureId":"f2","pass":"draw"},"inputSummary":{"stages":["draft"]},"steps":[{"kind":"tool","text":"자료 찾기","status":"completed","at":135}]}`),
			},
		},
	}
	q := Queries{Store: source, Now: func() time.Time { return time.UnixMilli(800) }}
	raw, err := q.HistoryView(t.Context(), "fixture")
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte(hidden)) {
		t.Fatal("provider-only fields reached the public history")
	}
	if !slices.Equal(source.reads, []string{"parent", "f1", "f2"}) {
		t.Fatalf("legacy reads were not deduplicated: %v", source.reads)
	}
	var result struct {
		Records []historyRecord
		Usage   historyUsage
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	batch := result.Records[1]
	if batch.ResultSource != "none" || batch.Output != nil || batch.Unavailable || len(batch.Steps) != 2 || batch.Steps[0].Text != "자료 읽기" || batch.Steps[1].Text != "자료 찾기" {
		t.Fatalf("batch history does not reflect saved public steps: %#v", batch)
	}
	individual := result.Records[3]
	if individual.ResultSource != "job" || !bytes.Contains(individual.Output["figures"], []byte("공개 설명")) {
		t.Fatal("public figure result was not retained")
	}
	attempts := result.Usage.Revisions[0].Stages[0].Attempts
	if result.Usage.Calls != 2 || result.Usage.MS != 80 || result.Usage.Tokens == nil || *result.Usage.Tokens != 12 ||
		attempts[0].Label != "회차 1 · 시각자료 생성 f1,f2 draw" || attempts[0].Outcome != "accepted" ||
		attempts[1].Outcome != "accepted" {
		t.Fatalf("unexpected usage stages: %#v", result.Usage)
	}
}

func TestHistoryNoteKeepsValidUnicodeWithinContract(t *testing.T) {
	full := strings.Repeat("🫐", 201)
	if got := limitHistoryNote(full); got != strings.Repeat("🫐", 200) {
		t.Fatal("note limit split an astral code point or exceeded the wire bound")
	}
}
