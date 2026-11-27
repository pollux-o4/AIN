package figureai

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

// Go 그림 프롬프트가 Node 기준과 바이트 단위로 같은지 확인한다 · 갱신: node testdata/generate.mjs <저장소>
func TestFIGURE001NodePromptParity(t *testing.T) {
	raw, err := os.ReadFile("testdata/node-reference.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct {
		State   json.RawMessage
		Prompts []struct {
			Name   string
			Action json.RawMessage
			Digest string
		}
	}
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	builder, err := New(Config{
		WorkRoot: t.TempDir(), Default: Model{Provider: "synthetic", Model: "fixture"},
		LayoutCheck: "/tools/layout-check.mjs", KitIndex: "/tools/kit-index.mjs",
	})
	if err != nil {
		t.Fatal(err)
	}
	run := contract.Run{ID: "article", Value: fmt.Appendf(nil, `{"state":%s}`, fixtures.State)}
	for _, sample := range fixtures.Prompts {
		t.Run(sample.Name, func(t *testing.T) {
			var head struct{ Stage, FigureID string }
			_ = json.Unmarshal(sample.Action, &head)
			action := contract.Action{Kind: "request_figure", Stage: head.Stage, FigureID: head.FigureID,
				StateVersion: 7, WorkID: strings.Repeat("a", 64), Input: sample.Action}
			spec, err := builder.BuildTurn(run, action)
			if err != nil {
				t.Fatal(err)
			}
			prompt := spec.Prompt
			if strings.Contains(sample.Name, "fix") {
				prompt = prompt[:strings.Index(prompt, "\n<자료>\n")]
			}
			if digest := fmt.Sprintf("%x", sha256.Sum256([]byte(prompt))); digest != sample.Digest {
				if os.Getenv("AIN_PROMPT_FIXTURE_DUMP") == sample.Name {
					t.Log(prompt)
				}
				t.Fatalf("Node prompt digest differs: got %s, want %s", digest, sample.Digest)
			}
		})
	}
}
