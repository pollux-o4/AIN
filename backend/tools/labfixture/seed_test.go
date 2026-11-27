package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/figuredomain"
	"github.com/pollux-o4/AIN/backend/internal/store"
	"github.com/pollux-o4/AIN/backend/internal/writing"
)

func TestSeedAndReportFromReadOnlySource(t *testing.T) {
	data, err := os.ReadFile("../../../tests/migration/reference/flow-001.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture []struct{ State object }
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	state := fixture[len(fixture)-1].State
	rules := writing.NewWithFigures(figuredomain.New())
	apply := func(run contract.Run, id, actor, kind string, fields object) contract.Run {
		t.Helper()
		result, err := rules.Reduce(run, contract.Event{ID: id, Actor: actor, Kind: kind, Body: encode(t, fields)})
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	draftSentence := "결제는 요청과 확인 순서로 진행됩니다."
	artifacts := state["artifacts"].(object)
	artifacts["draft"].(object)["output"].(object)["text"] = "# 제목\n\n" + draftSentence
	satisfied := apply(contract.Run{ID: "source", RequestID: "request", Version: 9,
		Value: encode(t, object{"state": state})}, "satisfied", "user", "satisfy",
		object{"expectedVersion": state["version"], "reviewedRevision": 1})
	plan := apply(satisfied, "request", "user", "request_figures", object{"expectedVersion": 10, "reviewedRevision": 1})
	choice := apply(plan, "completed", "adapter", "figure_result", object{
		"expectedVersion": 11, "stage": "figure_plan", "revision": 1,
		"output": object{"candidates": []object{{"anchor": draftSentence, "claim": "합성 관계", "reason": "합성 이유"}}},
	})

	t.Chdir(t.TempDir())
	ctx := t.Context()
	source, target := filepath.Join(".", "source-data"), filepath.Join(".local", "figure-lab", "fixture")
	db, err := store.Open(ctx, filepath.Join(source, "editorial.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := os.MkdirAll(target, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := db.CreateRun(ctx, choice); err != nil {
		t.Fatal(err)
	}
	reader, err := openReadOnly(source)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	id, raw, err := readRun(ctx, reader, "sour")
	if err != nil || id != choice.ID {
		t.Fatalf("read source = %q, %v", id, err)
	}
	for _, scenario := range []struct{ stage, status string }{
		{"plan", "satisfied"}, {"compose", "awaiting_figure_choice"},
	} {
		copies, err := seed(ctx, source, target, scenario.stage, 2, raw, provenance{Variant: "metaphor", Model: "fixture", Provider: "fixture"})
		if err != nil || len(copies) != 2 || copies[0] == copies[1] {
			t.Fatalf("seed %s = %v, %v", scenario.stage, copies, err)
		}
		lab, err := openReadOnly(target)
		if err != nil {
			t.Fatal(err)
		}
		defer lab.Close()
		_, cloned, err := readRun(ctx, lab, copies[0])
		var copy struct {
			State struct {
				ArticleID string
				Status    string
				Version   int
			}
		}
		if err != nil || json.Unmarshal(cloned, &copy) != nil || copy.State.ArticleID != copies[0] ||
			copy.State.Version != 1 || copy.State.Status != scenario.status {
			t.Fatalf("invalid cloned envelope: %+v, %v", copy.State, err)
		}
		report, err := makeReport(ctx, lab, copies[0], cloned)
		if err != nil || report.Lab == nil || report.Lab.Variant != "metaphor" || len(report.Events) != 0 {
			t.Fatalf("unexpected report provenance: %+v, %v", report.Lab, err)
		}
	}
	if _, err := isolatedTarget(target, target); err == nil {
		t.Fatal("same data directory accepted")
	}
	if _, err := isolatedTarget(source, source); err == nil {
		t.Fatal("production data directory accepted")
	}
	if _, err := reader.ExecContext(ctx, "DELETE FROM editorial_runs"); err == nil {
		t.Fatal("source was writable")
	}
}

func encode(t *testing.T, value any) json.RawMessage {
	t.Helper()
	result, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return result
}
