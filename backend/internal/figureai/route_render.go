package figureai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
)

type RouteLabel struct {
	Text   string       `json:"text"`
	Anchor *RouteAnchor `json:"anchor,omitempty"`
}

type RouteAnchor struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type RouteElement struct {
	Name  string `json:"name"`
	Quote string `json:"quote"`
}

type RouteMotif struct {
	Name string `json:"name"`
	Look string `json:"look"`
}

type RouteInput struct {
	Message   string            `json:"message"`
	Elements  []RouteElement    `json:"elements"`
	Regions   []string          `json:"regions,omitempty"`
	Moving    []string          `json:"moving,omitempty"`
	Labels    []RouteLabel      `json:"labels"`
	Style     map[string]string `json:"style"`
	Motifs    []RouteMotif      `json:"motifs"`
	Direction *string           `json:"direction"`
}

type RouteCandidate struct {
	ID       string
	Kind     string
	Override string
}

type RouteCapabilities struct {
	Motion      bool `json:"motion"`
	TextInImage bool `json:"textInImage"`
	PartialEdit bool `json:"partialEdit"`
	MaxChecks   int  `json:"maxChecks"`
}

type RouteAdapter struct {
	ID, Route, Version string
	Capabilities       RouteCapabilities
	Render             func(context.Context, RouteInput, string) (RouteOutput, error)
}

type RouteOutput struct {
	Files   []RouteFile
	Alt     string
	Caption *string
	Motion  bool
	Labels  []RouteLabel
	Model   *string
	Tokens  *int64
	Checks  int
}

type RouteProvenance struct {
	Route     string  `json:"route"`
	Adapter   string  `json:"adapter"`
	Model     *string `json:"model"`
	MS        int64   `json:"ms"`
	Tokens    *int64  `json:"tokens"`
	InputHash string  `json:"inputHash"`
	Checks    int     `json:"checks"`
}

type RouteResult struct {
	ID         string           `json:"id"`
	Route      string           `json:"route"`
	Files      []RouteFile      `json:"files"`
	Alt        string           `json:"alt"`
	Caption    *string          `json:"caption"`
	Motion     bool             `json:"motion"`
	Labels     []RouteLabel     `json:"labels"`
	Provenance *RouteProvenance `json:"provenance"`
}

// RouteCache stores validated metadata. Implementations must support concurrent
// operations when used by RenderBatch. Files remain in their original workspaces.
type RouteCache interface {
	Get(context.Context, string) (RouteCacheEntry, bool, error)
	Put(context.Context, string, RouteCacheEntry) error
}

type RouteCacheEntry struct {
	Result  RouteResult
	Digests [][sha256.Size]byte
}

type RouteRenderer struct {
	workRoot string
	routes   map[string]RouteAdapter
	cache    RouteCache
	now      func() time.Time
	inFlight sync.Map
}

// NewRouteRenderer configures only the explicitly injected route adapters.
func NewRouteRenderer(workRoot string, adapters []RouteAdapter, cache RouteCache, now func() time.Time) (*RouteRenderer, error) {
	if !filepath.IsAbs(workRoot) {
		return nil, errors.New("figure work root must be absolute")
	}
	workRoot = filepath.Clean(workRoot)
	if now == nil {
		now = time.Now
	}
	r := &RouteRenderer{workRoot: workRoot, routes: map[string]RouteAdapter{}, cache: cache, now: now}
	for _, adapter := range adapters {
		if !knownRoute(adapter.Route) {
			return nil, ErrRouteUnavailable
		}
		if _, exists := r.routes[adapter.Route]; exists {
			return nil, fmt.Errorf("duplicate adapter for route %s", adapter.Route)
		}
		if adapter.ID == "" || adapter.Version == "" || adapter.Render == nil ||
			adapter.Capabilities.MaxChecks < 0 || adapter.Capabilities.MaxChecks > 5 {
			return nil, errors.New("invalid figure route adapter")
		}
		r.routes[adapter.Route] = adapter
	}
	return r, nil
}

type RouteJob struct {
	Candidate RouteCandidate
	Input     RouteInput
	WorkID    string
}

// Render validates labels and files before publishing metadata to the cache.
// A cached result is available only for its original figure and workspace.
func (r *RouteRenderer) Render(ctx context.Context, job RouteJob) (RouteResult, error) {
	var result RouteResult
	candidate, input := job.Candidate, job.Input
	route := EffectiveRoute(candidate.Kind, candidate.Override)
	adapter, ok := r.routes[route]
	if !ok {
		return result, fmt.Errorf("%w: %s", ErrRouteUnavailable, route)
	}
	if !figureID.MatchString(candidate.ID) {
		return result, errors.New("invalid figure ID")
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	inputHash, err := routeHash(input)
	if err != nil {
		return result, err
	}
	key, err := routeHash([]string{inputHash, adapter.ID, adapter.Version, route, candidate.ID, r.workRoot, job.WorkID})
	if err != nil {
		return result, err
	}
	if _, busy := r.inFlight.LoadOrStore(job.WorkID, struct{}{}); busy {
		return result, errors.New("figure workspace already has a render in progress")
	}
	defer r.inFlight.Delete(job.WorkID)
	room, err := openWorkspace(r.workRoot, job.WorkID, true)
	if err != nil {
		return result, err
	}
	defer room.close()
	if r.cache != nil {
		if retained, found, err := r.cache.Get(ctx, key); err != nil {
			return result, err
		} else if found {
			if err := checkCached(room, job, adapter, inputHash, retained); err != nil {
				return result, err
			}
			return cloneRouteResult(retained.Result), ctx.Err()
		}
	}
	start := r.now()
	output, err := adapter.Render(ctx, input, room.dir)
	if err != nil {
		return result, err
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	if err := checkRouteOutput(adapter.Capabilities, input, &output); err != nil {
		return result, err
	}
	files, digests, err := validateRouteFiles(room, route, output.Files)
	if err != nil {
		return result, err
	}
	result = RouteResult{
		ID: candidate.ID, Route: route, Files: files, Alt: output.Alt, Caption: output.Caption,
		Motion: output.Motion, Labels: output.Labels,
		Provenance: &RouteProvenance{
			Route: route, Adapter: adapter.ID, Model: output.Model,
			MS:     max(0, r.now().Sub(start).Round(time.Millisecond).Milliseconds()),
			Tokens: output.Tokens, InputHash: inputHash, Checks: output.Checks,
		},
	}
	if err := ctx.Err(); err != nil {
		return RouteResult{}, err
	}
	if r.cache != nil {
		if err := r.cache.Put(ctx, key, RouteCacheEntry{Result: cloneRouteResult(result), Digests: digests}); err != nil {
			return RouteResult{}, err
		}
	}
	return result, nil
}

func cloneRouteResult(result RouteResult) RouteResult {
	result.Files = slices.Clone(result.Files)
	result.Labels = slices.Clone(result.Labels)
	for i, label := range result.Labels {
		result.Labels[i].Anchor = routeCopyPointer(label.Anchor)
	}
	result.Caption = routeCopyPointer(result.Caption)
	result.Provenance = routeCopyPointer(result.Provenance)
	if result.Provenance != nil {
		result.Provenance.Model = routeCopyPointer(result.Provenance.Model)
		result.Provenance.Tokens = routeCopyPointer(result.Provenance.Tokens)
	}
	return result
}

func routeCopyPointer[T any](value *T) *T {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}

func checkCached(room *workspace, job RouteJob, adapter RouteAdapter, hash string, entry RouteCacheEntry) error {
	result := entry.Result
	p := result.Provenance
	if result.ID != job.Candidate.ID || result.Route != adapter.Route || p == nil ||
		p.Route != adapter.Route || p.Adapter != adapter.ID || p.InputHash != hash || p.MS < 0 {
		return errors.New("invalid cached figure route metadata")
	}
	out := RouteOutput{Alt: result.Alt, Caption: result.Caption, Labels: slices.Clone(result.Labels),
		Motion: result.Motion, Tokens: p.Tokens, Checks: p.Checks}
	if err := checkRouteOutput(adapter.Capabilities, job.Input, &out); err != nil {
		return err
	}
	files, digests, err := validateRouteFiles(room, adapter.Route, result.Files)
	if err != nil {
		return err
	}
	if !slices.Equal(files, result.Files) || !slices.Equal(digests, entry.Digests) {
		return errors.New("cached figure route files changed")
	}
	return nil
}

func routeHash(value any) (string, error) {
	var data bytes.Buffer
	encoder := json.NewEncoder(&data)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return "", err
	}
	sum := sha256.Sum256(bytes.TrimSuffix(data.Bytes(), []byte("\n")))
	return hex.EncodeToString(sum[:]), nil
}

func checkRouteOutput(caps RouteCapabilities, input RouteInput, out *RouteOutput) error {
	if out.Motion && !caps.Motion || out.Checks < 0 || out.Checks > caps.MaxChecks || out.Tokens != nil && *out.Tokens < 0 {
		return errors.New("figure result exceeds adapter capabilities")
	}
	out.Caption = routeCopyPointer(out.Caption)
	if len(out.Labels) > 30 || !routeLine(&out.Alt, 300) || out.Caption != nil && !routeLine(out.Caption, 200) {
		return errors.New("invalid figure text metadata")
	}
	made := map[string]bool{}
	out.Labels = append([]RouteLabel{}, out.Labels...)
	for i := range out.Labels {
		label := &out.Labels[i]
		made[label.Text] = true
		if !routeLine(&label.Text, 80) || (label.Anchor == nil && !caps.TextInImage) ||
			(label.Anchor != nil && !(routeCoordinate(label.Anchor.X) && routeCoordinate(label.Anchor.Y))) {
			return errors.New("invalid figure label or missing anchor")
		}
	}
	for _, label := range input.Labels {
		if !made[label.Text] {
			return errors.New("requested figure label missing")
		}
	}
	return nil
}

func routeLine(s *string, limit int) bool {
	*s = strings.TrimSpace(*s)
	return *s != "" && utf16Length(*s) <= limit
}

func routeCoordinate(n float64) bool { return n >= 0 && n <= 1 }

type RouteOutcome struct {
	ID     string
	Result RouteResult
	Err    error
}

// RenderBatch keeps input order and isolates errors per workspace.
func (r *RouteRenderer) RenderBatch(ctx context.Context, jobs []RouteJob) []RouteOutcome {
	out := make([]RouteOutcome, len(jobs))
	seen := map[string]bool{}
	var group sync.WaitGroup
	for i, job := range jobs {
		if seen[job.WorkID] {
			out[i] = RouteOutcome{ID: job.Candidate.ID, Err: errors.New("duplicate figure route workspace")}
			continue
		}
		seen[job.WorkID] = true
		group.Go(func() {
			result, err := r.Render(ctx, job)
			out[i] = RouteOutcome{job.Candidate.ID, result, err}
		})
	}
	group.Wait()
	return out
}

// LegacyRouteResult projects saved inline SVG into route metadata for readers.
// It leaves the original persisted figure and its SVG unchanged.
func LegacyRouteResult(id, svg, alt string, caption *string) (RouteResult, error) {
	if !figureID.MatchString(id) || len(svg) > svgLimit {
		return RouteResult{}, errors.New("invalid legacy figure")
	}
	if err := validateMIME("image/svg+xml", []byte(svg)); err != nil {
		return RouteResult{}, err
	}
	out := RouteOutput{Alt: alt, Caption: caption}
	if err := checkRouteOutput(RouteCapabilities{}, RouteInput{}, &out); err != nil {
		return RouteResult{}, err
	}
	return RouteResult{
		ID: id, Route: "svg", Files: []RouteFile{{Path: id + ".svg", MIME: "image/svg+xml", Bytes: len(svg)}},
		Alt: out.Alt, Caption: out.Caption, Motion: IsAnimated(svg), Labels: out.Labels,
	}, nil
}
