package figureai

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

const validSVG = `<svg viewBox="0 0 4 4"><rect width="4" height="4"/></svg>`

func TestFIGURE001ScopedFilesAndResult(t *testing.T) {
	builder := newFixture(t)
	action := fixtureAction(t, "figure", "f1", object{
		"pass": "draw", "candidates": []object{{"id": "f1", "scene": "작업 장면", "kind": "flow"}},
	})
	spec, err := builder.BuildTurn(fixtureRun(), action)
	if err != nil || spec.WorkDir != filepath.Join(builder.config.WorkRoot, action.WorkID) || !strings.Contains(spec.Prompt, "f1.svg") {
		t.Fatalf("wrong generation session: %v", err)
	}
	svg := filepath.Join(spec.WorkDir, "f1.svg")
	source := filepath.Join(spec.WorkDir, "f1.source.mjs")
	writeFile(t, svg, validSVG)
	writeFile(t, source, "export const layout = 1;\n")
	response := object{"figures": []object{{"id": "f1", "alt": "설명", "svgFile": svg, "sourceFile": source}}}
	event, err := builder.ValidateResult(action, resultSnapshot(t, "첨부를 확인했습니다.\n```json\n"+string(raw(t, response))+"\n```"))
	if err != nil {
		t.Fatal(err)
	}
	var body object
	if json.Unmarshal(event.Body, &body) != nil || body["expectedVersion"] != float64(7) || body["revision"] != float64(3) ||
		body["figureId"] != "f1" || body["pass"] != "draw" || event.Kind != "figure_result" {
		t.Fatal("figure result omitted correlation metadata")
	}
	made := entry(rows(entry(body["output"])["figures"])[0])
	if made["source"] != "export const layout = 1;\n" || !strings.Contains(text(made["svg"]), `xmlns="http://www.w3.org/2000/svg"`) ||
		made["svgFile"] != nil || made["sourceFile"] != nil {
		t.Fatal("result failed to inline checked files")
	}
	other := filepath.Join(builder.config.WorkRoot, strings.Repeat("b", 64), "f1.svg")
	if err := os.Mkdir(filepath.Dir(other), 0700); err != nil {
		t.Fatal(err)
	}
	writeFile(t, other, validSVG)
	for _, row := range []object{
		{"id": "f2", "alt": "설명", "svgFile": svg},
		{"id": "f1", "alt": "설명", "svgFile": other},
		{"id": "f1", "alt": "설명", "svgFile": "f1.svg"},
		{"id": "f1", "alt": "설명", "svgFile": svg, "sourceFile": other},
		{"id": "f1", "alt": "설명", "svg": `<svg><script>alert(1)</script></svg>`},
	} {
		out := raw(t, object{"figures": []object{row}})
		if _, err := builder.ValidateResult(action, resultSnapshot(t, string(out))); err == nil {
			t.Fatal("invalid artifact passed result validation")
		}
	}
	if err := os.Remove(svg); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(other, svg); err != nil {
		t.Fatal(err)
	}
	if _, err := builder.ValidateResult(action, resultSnapshot(t, string(raw(t, response)))); err == nil {
		t.Fatal("cross-job symlink passed")
	}
	if err := os.Remove(svg); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(other, svg); err != nil {
		t.Fatal(err)
	}
	if _, err := builder.ValidateResult(action, resultSnapshot(t, string(raw(t, response)))); err == nil {
		t.Fatal("cross-job hard link passed")
	}
}

func TestADR0026FixUsesSeparateBaseline(t *testing.T) {
	builder := newFixture(t)
	action := fixtureAction(t, "figure", "f1", object{
		"pass": "fix", "candidates": []object{{"id": "f1", "fix": "간격 조절"}},
		"previous": []object{{"id": "f1", "svg": validSVG, "source": "const protectedBaseline = 123;"}},
	})
	spec, err := builder.BuildTurn(fixtureRun(), action)
	if err != nil {
		t.Fatal(err)
	}
	prior, err := os.ReadFile(filepath.Join(spec.WorkDir, "input-f1.source.mjs"))
	if err != nil || string(prior) != "const protectedBaseline = 123;" ||
		strings.Contains(spec.Prompt, "protectedBaseline") || !strings.Contains(spec.Prompt, "input-f1.source.mjs") {
		t.Fatal("prior source was not transferred as an isolated file")
	}
	if _, err := builder.BuildTurn(fixtureRun(), action); err != nil {
		t.Fatalf("same intent cannot recover staged input: %v", err)
	}
	writeFile(t, filepath.Join(spec.WorkDir, "input-f1.source.mjs"), "modified")
	if _, err := builder.BuildTurn(fixtureRun(), action); err == nil {
		t.Fatal("changed baseline accepted during retry")
	}
}

func TestFIGURE002StageAndRouteContracts(t *testing.T) {
	builder := newFixture(t)
	plan := fixtureAction(t, "figure_plan", "", object{"units": []string{"도입부"}, "note": "선택 위치"})
	spec, err := builder.BuildTurn(fixtureRun(), plan)
	if err != nil || spec.Model != "plan-model" || !strings.Contains(spec.Prompt, "placementNote") {
		t.Fatalf("invalid figure plan: %v", err)
	}
	compose := fixtureAction(t, "figure_compose", "", object{
		"candidates": []object{{"id": "f1"}, {"id": "f2"}}, "recompose": []string{"f2"},
	})
	candidate := object{"designs": []object{{"id": "f2", "scene": "다시 만든 장면"}}}
	if _, err := builder.ValidateResult(compose, resultSnapshot(t, string(raw(t, candidate)))); err != nil {
		t.Fatal(err)
	}
	if _, err := builder.ValidateResult(compose, resultSnapshot(t, `{"designs":[{"id":"f1","scene":"다른 장면"}]}`)); err == nil {
		t.Fatal("recomposition accepted the wrong candidate")
	}
	if _, err := builder.ValidateResult(plan, resultSnapshot(t, "렌더링을 확인하고 있습니다.")); !errors.Is(err, ErrResultPending) {
		t.Fatalf("progress note did not stay pending: %v", err)
	}
	idle := resultSnapshot(t, `{"candidates":[{"anchor":"문장","claim":"관계","reason":"내용"}]}`)
	idle.Status = "idle"
	if _, err := builder.ValidateResult(plan, idle); err == nil {
		t.Fatal("idle state passed terminal proof")
	}
	imageAction := fixtureAction(t, "figure", "f1", object{"pass": "draw", "candidates": []object{{"id": "f1", "kind": "scene"}}})
	if _, err := builder.BuildTurn(fixtureRun(), imageAction); !errors.Is(err, ErrRouteUnavailable) {
		t.Fatalf("image route silently fell back to SVG: %v", err)
	}
	if EffectiveRoute("scene", "svg") != "svg" || EffectiveRoute("structure", "") != "svg" {
		t.Fatal("route precedence changed")
	}
}

func TestFIGURE002FileAndStaticValidation(t *testing.T) {
	builder := newFixture(t)
	id := strings.Repeat("f", 64)
	dir := filepath.Join(builder.config.WorkRoot, id)
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(filepath.Join(dir, "image.png"))
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(file, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	files, err := ValidateRouteFiles(builder.config.WorkRoot, id, "image", []RouteFile{{Path: "image.png", MIME: "image/png", Bytes: 1}})
	if err != nil || len(files) != 1 || files[0].Bytes <= 1 {
		t.Fatalf("PNG byte count came from unverified metadata: %v", err)
	}
	writeFile(t, filepath.Join(dir, "broken.png"), "\x89PNG\r\n\x1a\n")
	// 2x2 red lossless fixture, generated once with ffmpeg/libwebp.
	webp, err := base64.StdEncoding.DecodeString("UklGRhwAAABXRUJQVlA4TA8AAAAvAUAAAAcQ9Y/+ByKi/wEA")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "image.webp"), webp, 0600); err != nil {
		t.Fatal(err)
	}
	if result, err := ValidateRouteFiles(builder.config.WorkRoot, id, "image", []RouteFile{{Path: "image.webp", MIME: "image/webp"}}); err != nil || len(result) != 1 || result[0].Bytes != len(webp) {
		t.Fatalf("invalid WebP check: %v", err)
	}
	for _, bad := range []RouteFile{
		{Path: "broken.png", MIME: "image/png"},
		{Path: "image.png", MIME: "image/webp"},
		{Path: "../image.png", MIME: "image/png"},
	} {
		if _, err := ValidateRouteFiles(builder.config.WorkRoot, id, "image", []RouteFile{bad}); err == nil {
			t.Fatal("invalid route file accepted")
		}
	}
	animated := `<svg viewBox="0 0 4 4"><style>@keyframes move{from{opacity:0}to{opacity:1}} rect{animation:move 2s}</style><rect x="1"><animate attributeName="x" from="0" to="1" dur="2s"/></rect><g><animateTransform attributeName="transform"><desc>설명</desc></animateTransform></g></svg>`
	static, err := StaticSVG(animated)
	if err != nil || !IsAnimated(animated) || strings.Contains(static, "<animate") ||
		!strings.Contains(static, `<rect x="1"></rect>`) || !strings.Contains(static, frozenStyle) {
		t.Fatalf("incorrect static image: %v %s", err, static)
	}
}

func newFixture(t *testing.T) *Builder {
	t.Helper()
	builder, err := New(Config{WorkRoot: t.TempDir(), Default: Model{Provider: "codex", Model: "base"},
		StageModels: map[string]Model{"figure_plan": {Provider: "codex", Model: "plan-model"}}})
	if err != nil {
		t.Fatal(err)
	}
	return builder
}

func fixtureRun() contract.Run {
	return contract.Run{ID: "fixture", Version: 11, Value: json.RawMessage(`{"state":{"version":7,"revision":3,"idea":"그림","artifacts":{"draft":{"output":{"text":"# 제목\n\n본문 문장.","changeSummary":"초고"}}}}}`)}
}

func fixtureAction(t *testing.T, stage, id string, data object) contract.Action {
	t.Helper()
	data["type"], data["stage"], data["revision"] = "request_figure", stage, 3
	if id != "" {
		data["figureId"] = id
	}
	return contract.Action{StateVersion: 7, WorkID: strings.Repeat("a", 64), Kind: "request_figure", Stage: stage, FigureID: id, Input: raw(t, data)}
}

func resultSnapshot(t *testing.T, text string) contract.Snapshot {
	t.Helper()
	return contract.Snapshot{Status: "completed", Body: raw(t, object{"daemonTurnId": "fixture-turn", "text": text})}
}

func raw(t *testing.T, value any) json.RawMessage {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func writeFile(t *testing.T, name, body string) {
	t.Helper()
	if err := os.WriteFile(name, []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
}
