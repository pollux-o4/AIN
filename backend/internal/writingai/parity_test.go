package writingai

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

func TestFLOW001NodeWritingTurnParity(t *testing.T) {
	raw, err := os.ReadFile("testdata/node-reference.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct {
		States  []json.RawMessage
		Prompts []struct {
			Name       string
			Digest     string
			StateIndex int
			Action     json.RawMessage
			Delivered  map[string]string
			Next       map[string]string
		}
		Results []struct {
			Name, Text, Actor, Type string
			Action, Body            json.RawMessage
		}
	}
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	builder := New(Config{
		Base: contract.SessionSpec{Provider: "synthetic", Model: "fixture", Thinking: "medium", WorkDir: "/synthetic"},
		High: contract.SessionSpec{Provider: "synthetic", Model: "fixture", Thinking: "high"},
	})
	for _, sample := range fixtures.Prompts {
		t.Run("prompt "+sample.Name, func(t *testing.T) {
			run := contract.Run{ID: "article", Value: fmt.Appendf(nil, `{"state":%s}`, fixtures.States[sample.StateIndex])}
			action := fixtureAction(sample.Action)
			var spec contract.SessionSpec
			var err error
			if sample.Delivered == nil {
				spec, err = builder.BuildTurn(run, action)
			} else {
				var next map[string]string
				spec, next, err = builder.BuildReuseTurn(run, action, sample.Delivered)
				if !reflect.DeepEqual(next, sample.Next) {
					t.Errorf("delivery fingerprints differ: got %v, want %v", next, sample.Next)
				}
			}
			if err != nil {
				t.Fatal(err)
			}
			if digest := fmt.Sprintf("%x", sha256.Sum256([]byte(spec.Prompt))); digest != sample.Digest {
				if os.Getenv("AIN_PROMPT_FIXTURE_DUMP") == sample.Name {
					t.Log(spec.Prompt)
				}
				t.Fatalf("Node prompt digest differs: got %s, want %s", digest, sample.Digest)
			}
			if !strings.Contains(spec.Prompt, "<자료>\n") {
				t.Fatal("missing prompt data boundary")
			}
		})
	}
	for _, sample := range fixtures.Results {
		t.Run("result "+sample.Name, func(t *testing.T) {
			action := fixtureAction(sample.Action)
			body := encode(map[string]any{"daemonTurnId": "turn", "text": sample.Text})
			event, err := builder.ValidateResult(action, contract.Snapshot{Status: "completed", Body: body})
			if err != nil || event.Actor != sample.Actor || event.Kind != sample.Type {
				t.Fatalf("result metadata = %q %q, %v", event.Actor, event.Kind, err)
			}
			var got, want any
			if json.Unmarshal(event.Body, &got) != nil || json.Unmarshal(sample.Body, &want) != nil {
				t.Fatal("invalid parity event payload")
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("result differs: got %s, want %s", event.Body, sample.Body)
			}
		})
	}
}

func TestJUDGE001InvalidWritingOutputDiagnosticsArePrivate(t *testing.T) {
	builder := New(Config{})
	action := fixtureAction([]byte(`{"type":"request_ai","stage":"topic","revision":2}`))
	for _, text := range []string{
		`{"problem":"SYNTHETIC_PRIVATE_MARKER","scope":null}`,
		strings.Repeat("🧪", resultLimit/2+1),
	} {
		body := encode(map[string]any{"daemonTurnId": "turn", "text": text})
		_, err := builder.ValidateResult(action, contract.Snapshot{Status: "completed", Body: body})
		if err == nil || strings.Contains(err.Error(), "SYNTHETIC_PRIVATE_MARKER") || strings.Contains(err.Error(), "🧪") {
			t.Fatalf("expected an error without model content, got %v", err)
		}
	}
}

func fixtureAction(raw json.RawMessage) contract.Action {
	fields := fields(raw)
	return contract.Action{Kind: stringOf(fields["type"]), Stage: stringOf(fields["stage"]), StateVersion: 7, Input: raw}
}

func TestWritingPromptJSONMatchesNativeEscapes(t *testing.T) {
	raw := json.RawMessage(`{"source":"\u003c\/자료\u003e\u0026\u2028\u2029\\u003c"}`)
	want := "{\"source\":\"</자료>&\u2028\u2029\\\\u003c\"}"
	if got := string(encode(raw)); got != want {
		t.Fatalf("writing data escape parity = %q, want %q", got, want)
	}
}
