package figureai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const routeSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><text>산길</text></svg>`

func TestFIGURE002RenderRouteParity(t *testing.T) {
	ctx := t.Context()
	work := t.TempDir()
	var svgCalls atomic.Int64
	var imageCalls atomic.Int64
	var clock atomic.Int64
	cache := &testRouteCache{}
	clock5 := func() time.Time { return time.UnixMilli(clock.Add(5)) }
	model, tokens := "m", int64(10)
	svg := SVGRoute("svg-fake", "1", 2, func(context.Context, RouteInput, string) (SVGDrawResult, error) {
		svgCalls.Add(1)
		return SVGDrawResult{SVG: routeSVG, Alt: "산길 그림", Model: &model, Tokens: &tokens, Checks: 1}, nil
	})
	raster := ImageRoute("image-fake", "1", false, func(_ context.Context, prompt, dir string) (ImageGenerateResult, error) {
		imageCalls.Add(1)
		if !strings.Contains(prompt, "No text, letters or numbers in the image.") {
			return ImageGenerateResult{}, errors.New("image route did not request overlay labels")
		}
		var data bytes.Buffer
		if err := png.Encode(&data, image.NewRGBA(image.Rect(0, 0, 2, 3))); err != nil {
			return ImageGenerateResult{}, err
		}
		err := os.WriteFile(filepath.Join(dir, "f.png"), data.Bytes(), 0o600)
		return ImageGenerateResult{Path: "f.png", MIME: "image/png", Alt: "산길 장면",
			Labels: []RouteLabel{{Text: "산길", Anchor: &RouteAnchor{X: 0.2, Y: 0.8}}}}, err
	})
	renderer, err := NewRouteRenderer(work, []RouteAdapter{svg, raster}, cache, clock5)
	if err != nil {
		t.Fatal(err)
	}
	input := routeFixtureInput()
	job := RouteJob{Candidate: RouteCandidate{ID: "f4", Kind: "flow"}, Input: input, WorkID: strings.Repeat("a", 64)}
	drawing, err := renderer.Render(ctx, job)
	if err != nil {
		t.Fatal(err)
	}
	p := drawing.Provenance
	const nodeFixtureHash = "d92054a2c2fa1b838568ce93f6641dddb8795e19a280e799f1f427e6540c1b88"
	if drawing.Route != "svg" || drawing.Motion || drawing.Labels[0].Text != "산길" ||
		drawing.Files[0].Bytes != len(routeSVG) || p.Adapter != "svg-fake" || p.MS != 5 ||
		p.InputHash != nodeFixtureHash || p.Checks != 1 || *p.Model != "m" || *p.Tokens != 10 {
		t.Fatalf("SVG result = %+v, provenance = %+v", drawing, p)
	}
	if _, err := renderer.Render(ctx, job); err != nil || svgCalls.Load() != 1 {
		t.Fatalf("verified cached render = %d calls, %v", svgCalls.Load(), err)
	}
	foreign := job
	foreign.WorkID, foreign.Candidate.ID = strings.Repeat("b", 64), "f2"
	if result, err := renderer.Render(ctx, foreign); err != nil || svgCalls.Load() != 2 || result.ID != "f2" {
		t.Fatalf("different workspace reused a cached result: %+v, %v", result, err)
	}
	file := filepath.Join(work, job.WorkID, "figure.svg")
	changed := strings.Replace(routeSVG, "산길", "물길", 1)
	if err := os.WriteFile(file, []byte(changed), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := renderer.Render(ctx, job); err == nil || svgCalls.Load() != 2 {
		t.Fatalf("same-size replacement was accepted or rerendered: %v", err)
	}

	photo := RouteJob{Candidate: RouteCandidate{ID: "f4", Kind: "flow", Override: "image"},
		Input: input, WorkID: strings.Repeat("c", 64)}
	picture, err := renderer.Render(ctx, photo)
	if err != nil {
		t.Fatal(err)
	}
	if picture.Route != "image" || picture.Motion || picture.Provenance.Tokens != nil ||
		picture.Labels[0].Anchor == nil || picture.Labels[0].Anchor.X != 0.2 || imageCalls.Load() != 1 {
		t.Fatalf("image result = %+v", picture)
	}
	if prompt := ImageRoutePrompt(input, true); !strings.Contains(prompt, `"산길"`) {
		t.Fatalf("text-in-image prompt = %q", prompt)
	}
	legacy, err := LegacyRouteResult("f1", routeSVG, "설명", nil)
	if err != nil || legacy.Route != "svg" || legacy.Provenance != nil || legacy.Files[0].Path != "f1.svg" {
		t.Fatalf("legacy projection = %+v, %v", legacy, err)
	}
}

func TestFIGURE002RouteErrorsDoNotPublish(t *testing.T) {
	ctx := t.Context()
	work := t.TempDir()
	cache := &testRouteCache{}
	svg := SVGRoute("svg", "1", 2, func(_ context.Context, input RouteInput, dir string) (SVGDrawResult, error) {
		return SVGDrawResult{SVG: routeSVG, Alt: "fixture"}, nil
	})
	renderer, err := NewRouteRenderer(work, []RouteAdapter{svg}, cache, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewRouteRenderer(work, []RouteAdapter{svg, svg}, cache, nil); err == nil {
		t.Fatal("duplicate adapter was accepted")
	}
	input := routeFixtureInput()
	missing := routeFixtureInput()
	missing.Labels[0].Text = "다른 표지"
	makeJob := func(id, kind, letter string, input RouteInput) RouteJob {
		return RouteJob{Candidate: RouteCandidate{ID: id, Kind: kind}, WorkID: strings.Repeat(letter, 64), Input: input}
	}
	jobs := []RouteJob{makeJob("f1", "flow", "a", input), makeJob("f2", "scene", "b", input), makeJob("f3", "flow", "c", missing)}
	out := renderer.RenderBatch(ctx, jobs)
	if out[0].Err != nil || !errors.Is(out[1].Err, ErrRouteUnavailable) ||
		out[2].Err == nil || !strings.Contains(out[2].Err.Error(), "label missing") || len(cache.entries) != 1 {
		t.Fatalf("batch outcomes = %+v, published = %d", out, len(cache.entries))
	}
	if _, err := os.Stat(filepath.Join(work, jobs[1].WorkID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing image adapter created a workspace: %v", err)
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := renderer.Render(canceled, jobs[0]); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled cache lookup = %v", err)
	}

	checks := 2
	output := RouteOutput{Alt: "fixture", Motion: true, Labels: input.Labels, Checks: checks}
	if err := checkRouteOutput(RouteCapabilities{}, input, &output); err == nil {
		t.Fatal("unsupported motion/checks were accepted")
	}
	output.Motion, output.Checks = false, 0
	if err := checkRouteOutput(RouteCapabilities{}, input, &output); err == nil {
		t.Fatal("overlay label without anchor was accepted")
	}
	output.Labels[0].Anchor = &RouteAnchor{X: 1.01, Y: 0}
	if err := checkRouteOutput(RouteCapabilities{}, input, &output); err == nil {
		t.Fatal("anchor outside normalized coordinates was accepted")
	}
}

func TestFIGURE002BoundedRasterAndSafeWorkspace(t *testing.T) {
	// Real 2x4 lossless WebP generated from a synthetic blue image by libwebp.
	webpBytes, err := base64.StdEncoding.DecodeString("UklGRhwAAABXRUJQVlA4TA8AAAAvAcAAAAcQ0f/+ByKi/wEA")
	if err != nil {
		t.Fatal(err)
	}
	if err := validateMIME("image/webp", webpBytes); err != nil {
		t.Fatal(err)
	}
	broken := bytes.Clone(webpBytes)
	clear(broken[25:])
	if !validWebP(broken) || validateMIME("image/webp", broken) == nil {
		t.Fatal("corrupt WebP with intact container and frame headers was accepted")
	}
	oversized := bytes.Clone(webpBytes)
	binary.LittleEndian.PutUint32(oversized[21:25], 16383|(16383<<14))
	if validateMIME("image/webp", oversized) == nil {
		t.Fatal("oversized WebP was accepted")
	}
	var pngBytes bytes.Buffer
	if err := png.Encode(&pngBytes, image.NewRGBA(image.Rect(0, 0, 2, 3))); err != nil {
		t.Fatal(err)
	}
	for _, file := range []struct {
		path, mime string
		data       []byte
	}{
		{"figure.webp", "image/webp", webpBytes},
		{"figure.png", "image/png", pngBytes.Bytes()},
	} {
		root := t.TempDir()
		id := strings.Repeat("a", 64)
		room, err := openWorkspace(root, id, true)
		if err != nil {
			t.Fatal(err)
		}
		room.close()
		path := filepath.Join(room.dir, file.path)
		if err := os.WriteFile(path, file.data, 0o600); err != nil {
			t.Fatal(err)
		}
		result, err := ValidateRouteFiles(root, id, "image", []RouteFile{{Path: file.path, MIME: file.mime, Bytes: 1}})
		if err != nil || result[0].Bytes != len(file.data) {
			t.Fatalf("measured raster = %+v, %v", result, err)
		}
		if err := os.Symlink(path, filepath.Join(room.dir, "linked")); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{"../" + file.path, "linked"} {
			if _, err := ValidateRouteFiles(root, id, "image", []RouteFile{{Path: name, MIME: file.mime}}); err == nil {
				t.Fatalf("unsafe raster path %q was accepted", name)
			}
		}
		if _, err := ValidateRouteFiles(root, id, "svg", []RouteFile{{Path: file.path, MIME: file.mime}}); err == nil {
			t.Fatal("raster file passed the SVG route")
		}
	}
}

func routeFixtureInput() RouteInput {
	return RouteInput{
		Message: "갈림길에서 되돌아온다", Elements: []RouteElement{{Name: "갈림길", Quote: "갈림길"}},
		Labels: []RouteLabel{{Text: "산길"}}, Style: map[string]string{"accent": "주황"}, Motifs: []RouteMotif{},
	}
}

type testRouteCache struct {
	mu      sync.Mutex
	entries map[string]RouteCacheEntry
}

func (c *testRouteCache) Get(_ context.Context, key string) (RouteCacheEntry, bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	return entry, ok, nil
}

func (c *testRouteCache) Put(_ context.Context, key string, entry RouteCacheEntry) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.entries == nil {
		c.entries = map[string]RouteCacheEntry{}
	}
	c.entries[key] = entry
	return nil
}
