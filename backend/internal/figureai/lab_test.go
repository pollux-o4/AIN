package figureai

import (
	"strings"
	"testing"
)

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
	for _, test := range []struct {
		action actionInput
		want   string
	}{
		{actionInput{Stage: "figure_plan"}, ""},
		{actionInput{Stage: "figure_compose"}, "PLAN FIXTURE\n점검: CHECK FIXTURE"},
		{actionInput{Stage: "figure", Pass: "draw", FigureID: "f1"}, "DRAW FIXTURE\n"},
		{actionInput{Stage: "figure", Pass: "fix", FigureID: "f1"}, ""},
	} {
		standard, err := base.prompt(test.action, object{})
		if err != nil {
			t.Fatal(err)
		}
		got, err := variant.prompt(test.action, object{})
		if err != nil {
			t.Fatal(err)
		}
		want := standard
		switch test.action.Stage {
		case "figure_compose":
			want = strings.Replace(standard, defaultComposeAnalogy, test.want, 1)
		case "figure":
			if test.action.Pass == "draw" {
				want = strings.Replace(standard, drawInstructions, drawInstructions+"\n"+strings.TrimSuffix(test.want, "\n"), 1)
			}
		}
		if got != want {
			t.Fatalf("unexpected prompt edit for %s (%s)", test.action.Stage, test.action.Pass)
		}
	}
}
