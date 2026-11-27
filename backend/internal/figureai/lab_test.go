package figureai

import (
	"strings"
	"testing"
)

// 연구소 변형은 대상 정책(plan·check·draw) 문구만 바꾼다 · LAB-001
func TestLabPolicyChangesOnlyTargetPromptInstructions(t *testing.T) {
	policy := &LabPolicy{Plan: "PLAN FIXTURE", Check: "CHECK FIXTURE", Draw: "DRAW FIXTURE"}
	base, err := New(Config{WorkRoot: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	variant, err := New(Config{WorkRoot: t.TempDir(), LabPolicy: policy})
	if err != nil {
		t.Fatal(err)
	}
	swap := strings.NewReplacer(templates.Baseline.Plan, policy.Plan, templates.Baseline.Check, policy.Check,
		templates.Baseline.Draw, policy.Draw)
	for _, action := range []actionInput{
		{Stage: "figure_plan"},
		{Stage: "figure_compose"},
		{Stage: "figure", Pass: "draw", FigureID: "f1"},
		{Stage: "figure", Pass: "fix", FigureID: "f1"},
	} {
		standard, got := base.prompt(action, []byte("{}")), variant.prompt(action, []byte("{}"))
		if got != swap.Replace(standard) {
			t.Fatalf("unexpected prompt edit for %s (%s)", action.Stage, action.Pass)
		}
	}
}
