package figuredomain

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/writing"
)

const article = "# 쇼핑몰 구조\n\n주문과 결제는 책임이 다릅니다. 그래서 둘을 나눕니다.\n\n## 결제\n\n결제는 요청과 확인 순서로 진행됩니다."
const anchor1 = "주문과 결제는 책임이 다릅니다."
const anchor2 = "결제는 요청과 확인 순서로 진행됩니다."
const drawing = `<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/></svg>`

func TestFIGURE001Workflow(t *testing.T) {
	rules := writing.NewWithFigures(New())
	run := presentedRun(t)
	step := func(kind, actor string, body object) {
		t.Helper()
		run = applyEvent(t, rules, run, kind, actor, body)
	}
	reviewed := object{"reviewedRevision": 1}
	step("satisfy", "user", reviewed)
	step("request_figures", "user", reviewed)
	action, err := rules.Next(run)
	if err != nil {
		t.Fatal(err)
	}
	var proposal object
	if json.Unmarshal(action.Input, &proposal) != nil || !reflect.DeepEqual(ids(proposal["units"]), []string{"도입부", "결제"}) {
		t.Fatalf("unexpected planning action %s", action.Input)
	}
	step("figure_result", "adapter", object{"revision": 1, "stage": "figure_plan", "output": object{"candidates": []object{
		{"anchor": anchor1, "claim": "책임 경계", "reason": "관계"},
		{"anchor": "없는 문장", "claim": "제외", "reason": "없음"},
		{"anchor": anchor1, "claim": "중복", "reason": "중복"},
		{"anchor": anchor2, "claim": "결제 순서", "reason": "흐름"},
	}}})
	step("place_figure", "user", object{"reviewedRevision": 1, "quote": object{"exact": "그래서 둘을 나눕니다."}, "claim": "경계"})
	state := readState(t, run)
	if got := itemIDs(obj(state["figure"])["candidates"]); !reflect.DeepEqual(got, []string{"f1", "f3", "f2"}) {
		t.Fatalf("unexpected anchor order %v", got)
	}
	step("remove_figure", "user", object{"reviewedRevision": 1, "figure": "f3"})
	step("select_figures", "user", object{"reviewedRevision": 1, "figures": []string{"f2", "f1"}, "look": "stick"})
	step("figure_result", "adapter", object{"revision": 1, "stage": "figure_compose", "output": object{"designs": []object{
		{"id": "f1", "scene": "주문 장면"}, {"id": "f2", "scene": "결제 장면"},
	}}})
	step("approve_design", "user", reviewed)
	parent, err := rules.Next(run)
	if err != nil {
		t.Fatal(err)
	}
	parent.StateVersion = run.Version
	parts, err := PartActions(parent)
	if err != nil || len(parts) != 2 || parts[0].FigureID != "f1" || parts[1].FigureID != "f2" || parts[0].StateVersion != parent.StateVersion {
		t.Fatalf("invalid generation split %v", err)
	}
	if _, err := Collect(parent, "missing", run.Version, []ChildResult{{FigureID: "f1", Revision: 1, Pass: "draw", Failure: "failed"}}); err == nil {
		t.Fatal("missing outcome passed aggregation")
	}
	if _, err := Collect(parent, "stale", run.Version, []ChildResult{
		{FigureID: "f1", Revision: 1, Pass: "draw", Failure: "failed"},
		{FigureID: "f2", Revision: 2, Pass: "draw", Failure: "failed"},
	}); err == nil {
		t.Fatal("stale outcome passed aggregation")
	}
	if _, err := Collect(parent, "all-fail", run.Version, []ChildResult{
		{FigureID: "f1", Revision: 1, Pass: "draw", Failure: "failed"},
		{FigureID: "f2", Revision: 1, Pass: "draw", Failure: "failed"},
	}); !errors.Is(err, ErrNoFiguresPrepared) {
		t.Fatalf("all failures produced no explicit stop: %v", err)
	}
	child := func(id string) json.RawMessage {
		return raw(t, object{"id": id, "svg": drawing, "alt": id, "notes": "인계만"})
	}
	event, err := Collect(parent, "partially-finished", run.Version, []ChildResult{
		{FigureID: "f2", Revision: 1, Pass: "draw", Failure: "failed"},
		{FigureID: "f1", Revision: 1, Pass: "draw", Figure: child("f1")},
	})
	if err != nil {
		t.Fatal(err)
	}
	run, err = rules.Reduce(run, event)
	if err != nil {
		t.Fatal(err)
	}
	state = readState(t, run)
	if state["status"] != review || obj(obj(state["figure"])["failed"])["f2"] != "failed" || draftText(state) != article {
		t.Fatal("partial batch did not preserve draft and only mark prepared images")
	}
	if _, err := rules.Reduce(run, contract.Event{ID: "early-publication", Actor: "user", Kind: "authorize_publication",
		Body: raw(t, object{"expectedVersion": run.Version, "reviewedRevision": 1})}); err == nil {
		t.Fatal("generation advanced publication approval early")
	}
	step("retry_figures", "user", object{"reviewedRevision": 1, "figures": []string{"f2"}})
	parent, err = rules.Next(run)
	if err != nil {
		t.Fatal(err)
	}
	parts, err = PartActions(parent)
	if err != nil || len(parts) != 1 || parts[0].FigureID != "f2" {
		t.Fatal("retry failed to keep the prepared first figure")
	}
	step("figure_result", "adapter", object{"revision": 1, "stage": "figure", "figureId": "f2", "output": object{"figures": []json.RawMessage{child("f2")}}})
	step("confirm_figures", "user", object{"reviewedRevision": 1, "figures": []string{"f2"}})
	step("authorize_publication", "user", reviewed)
	state = readState(t, run)
	if state["status"] != "publication_ready" || !reflect.DeepEqual(ids(obj(state["approval"])["figures"]), []string{"f2"}) {
		t.Fatal("authorization did not record exactly the confirmed figures")
	}
	item := indexItems(obj(state["figure"])["items"])["f2"]
	if !strings.Contains(str(item["svg"]), svgNamespace) || item["notes"] != nil {
		t.Fatal("final figure retained notes or lacked SVG namespace")
	}
}

func TestADR0030AndSVG(t *testing.T) {
	markdown := "## 제목\n\n- 먼저 **굵은 글**과 `코드` 그리고 [링크](https://example.test)를 읽는다."
	got, _ := projection(markdown)
	if got != "제목 먼저 굵은 글과 코드 그리고 링크를 읽는다." {
		t.Fatalf("unexpected plain projection %q", got)
	}
	anchor, reason := resolveQuote(markdown, object{"exact": "먼저 굵은 글과 코드 그리고 링크를 읽는다."}, nil)
	if reason != "" || anchor != markdown[strings.Index(markdown, "먼저"):] {
		t.Fatalf("cannot recover markdown source: %s", reason)
	}
	for _, sample := range []struct{ text, exact, want string }{
		{"본문", "없음", "not_found"},
		{"같음 같음", "같음", "ambiguous"},
		{"첫 문장\n\n## 다음\n\n끝", "첫 문장 다음 끝", "crosses_unit"},
	} {
		if _, got := resolveQuote(sample.text, object{"exact": sample.exact}, nil); got != sample.want {
			t.Fatalf("expected %s, got %s", sample.want, got)
		}
	}
	if valid, err := normalizeSVG(drawing); err != nil || !strings.Contains(valid, svgNamespace) {
		t.Fatalf("valid SVG rejected: %v", err)
	}
	for _, invalid := range []string{
		`<svg><script>alert(1)</script></svg>`,
		`<svg><use href="https://example.test/f.svg#target"/></svg>`,
		`<svg><rect fill="url(https://example.test/a.svg)"/></svg>`,
		`<svg><animate attributeName="xlink:href"/></svg>`,
		`<svg><rect onclick="alert(1)"/></svg>`,
		`<svg xml:base="https://example.test/a.svg"><use href="#x"/></svg>`,
		`<svg><style><![CDATA[@im]]><![CDATA[port "https://example.test/style.css";]]></style></svg>`,
		`<svg><rect></svg>`,
	} {
		if _, err := normalizeSVG(invalid); err == nil {
			t.Fatalf("unsafe SVG accepted: %s", invalid)
		}
	}
}

func presentedRun(t *testing.T) contract.Run {
	t.Helper()
	data, err := os.ReadFile("../../../tests/migration/reference/flow-001.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture []struct{ State object }
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	state := fixture[len(fixture)-1].State
	obj(obj(obj(state["artifacts"])["draft"])["output"])["text"] = article
	return contract.Run{ID: "fixture", RequestID: "fixture", Version: 9, Value: raw(t, object{"state": state})}
}

func readState(t *testing.T, run contract.Run) object {
	t.Helper()
	var record object
	if err := json.Unmarshal(run.Value, &record); err != nil {
		t.Fatal(err)
	}
	return obj(record["state"])
}

func raw(t *testing.T, value any) json.RawMessage {
	t.Helper()
	body, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func applyEvent(t *testing.T, rules *writing.Rules, run contract.Run, kind, actor string, body object) contract.Run {
	t.Helper()
	body["expectedVersion"] = readState(t, run)["version"]
	next, err := rules.Reduce(run, contract.Event{ID: fmt.Sprintf("%s-%d", kind, run.Version), Kind: kind, Actor: actor, Body: raw(t, body)})
	if err != nil {
		t.Fatal(err)
	}
	return next
}

// The fixture records the legacy transition and nextAction for a full figure
// workflow through partial failure, retry, local fix and targeted recomposition.
func TestFIGURE001LegacyParity(t *testing.T) {
	data, err := os.ReadFile("testdata/figure-001.json")
	if err != nil {
		t.Fatal(err)
	}
	var steps []struct {
		Event  json.RawMessage
		Figure object
		Status string
		Next   object
	}
	if err := json.Unmarshal(data, &steps); err != nil {
		t.Fatal(err)
	}
	rules := writing.NewWithFigures(New())
	run := presentedRun(t)
	for _, step := range steps {
		var event object
		if err := json.Unmarshal(step.Event, &event); err != nil {
			t.Fatal(err)
		}
		label := str(event["id"]) + "/" + str(event["type"])
		run, err = rules.Reduce(run, contract.Event{Body: step.Event})
		if err != nil {
			t.Fatalf("%s: %v", label, err)
		}
		state := readState(t, run)
		if state["status"] != step.Status || !reflect.DeepEqual(obj(state["figure"]), step.Figure) {
			t.Fatalf("%s: expected %s %s, got %s %s", label, step.Status, raw(t, step.Figure), state["status"], raw(t, state["figure"]))
		}
		got, err := rules.Next(run)
		if err != nil {
			t.Fatal(err)
		}
		var actual object
		if err := json.Unmarshal(got.Input, &actual); err != nil || !reflect.DeepEqual(actual, step.Next) {
			t.Fatalf("%s: expected action %s, got %s", label, raw(t, step.Next), got.Input)
		}
	}
}
