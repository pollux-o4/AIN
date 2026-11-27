package artifacts

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

type runFixture struct{ run contract.Run }

func (f runFixture) GetRun(_ context.Context, id string) (contract.Run, error) {
	if f.run.ID != id {
		return contract.Run{}, contract.ErrNotFound
	}
	return f.run, nil
}

type goldenFile[T any] struct {
	Body                  T
	ContentType, Filename string
	SHA256                string
}
type golden struct {
	Article struct {
		ID, Title, Text string
		Revision        int
		Figures         []figure
	}
	Preview      string
	Approval     bundleApproval
	TXT, HTML    goldenFile[string]
	ZIP, Handoff goldenFile[map[string]string]
	Request      string
}

func fixture(t *testing.T) golden {
	t.Helper()
	raw, err := os.ReadFile("testdata/node-exports.json")
	if err != nil {
		t.Fatal(err)
	}
	var expected golden
	if err := json.Unmarshal(raw, &expected); err != nil {
		t.Fatal(err)
	}
	return expected
}

func fixtureRun(t *testing.T, golden golden, status, phase string, approvedRevision int) contract.Run {
	t.Helper()
	a := golden.Article
	current := map[string]any{
		"version": 12, "revision": a.Revision, "idea": "fixture",
		"status": status, "satisfiedRevision": a.Revision,
		"artifacts": map[string]any{"draft": map[string]any{"revision": a.Revision, "output": map[string]any{"text": a.Text}}},
		"history":   []any{map[string]any{"revision": 1, "artifacts": map[string]any{"draft": map[string]any{"revision": 1, "output": map[string]any{"text": "# 이전\r\n\r\n원래 문단\r\n"}}}}},
		"figure":    map[string]any{"phase": phase, "items": a.Figures, "candidates": a.Figures, "selected": []string{"f1", "f2"}},
		"approval":  map[string]any{"revision": approvedRevision, "figures": []string{"f1"}},
	}
	raw, err := json.Marshal(map[string]any{
		"state":  current,
		"events": []any{map[string]any{"kind": "authorize_publication", "at": golden.Approval.ApprovedAt}},
	})
	if err != nil {
		t.Fatal(err)
	}
	return contract.Run{ID: a.ID, Version: 12, Value: raw}
}

func fileContents(t *testing.T, body []byte) map[string]string {
	t.Helper()
	reader, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatal(err)
	}
	result := make(map[string]string)
	for _, entry := range reader.File {
		if entry.Method != zip.Store || entry.Flags != 0x0800 || !filepath.IsLocal(entry.Name) {
			t.Fatalf("unexpected ZIP header: %s (method %d, flags %x)", entry.Name, entry.Method, entry.Flags)
		}
		if _, exists := result[entry.Name]; exists {
			t.Fatalf("duplicate ZIP entry: %s", entry.Name)
		}
		opened, err := entry.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(opened)
		if err := errors.Join(err, opened.Close()); err != nil {
			t.Fatal(err)
		}
		result[entry.Name] = string(data)
	}
	return result
}

func equalBody(t *testing.T, name, got, want string) {
	t.Helper()
	if got == want {
		return
	}
	at := 0
	for at < len(got) && at < len(want) && got[at] == want[at] {
		at++
	}
	t.Errorf("%s differs at byte %d\ngot:  %q\nwant: %q", name, at, got[at:min(len(got), at+100)], want[at:min(len(want), at+100)])
}
func equalZIP(t *testing.T, got []byte, want map[string]string) {
	t.Helper()
	contents := fileContents(t, got)
	if len(contents) != len(want) {
		t.Fatalf("got %d files; want %d", len(contents), len(want))
	}
	for name, expected := range want {
		equalBody(t, name, contents[name], expected)
	}
}

func TestNodeExportGolden(t *testing.T) {
	ctx := context.Background()
	expected := fixture(t)
	run := fixtureRun(t, expected, "publication_ready", "confirmed", 2)
	service, err := New(runFixture{run}, "")
	if err != nil {
		t.Fatal(err)
	}
	preview, err := PreviewRun(run)
	if err != nil {
		t.Fatal(err)
	}
	equalBody(t, "preview", preview, expected.Preview)
	for _, item := range []struct {
		format string
		want   goldenFile[string]
	}{{"txt", expected.TXT}, {"html", expected.HTML}} {
		file, err := service.Export(ctx, run.ID, Options{Format: item.format})
		if err != nil {
			t.Fatal(err)
		}
		if file.ContentType != item.want.ContentType || file.Filename != item.want.Filename {
			t.Fatalf("export headers: %s, %s", file.ContentType, file.Filename)
		}
		equalBody(t, item.format, string(file.Body), item.want.Body)
	}
	file, err := service.Export(ctx, run.ID, Options{Format: "zip"})
	if err != nil {
		t.Fatal(err)
	}
	if file.ContentType != expected.ZIP.ContentType || file.Filename != expected.ZIP.Filename {
		t.Fatal("ZIP headers differ")
	}
	equalZIP(t, file.Body, expected.ZIP.Body)
	if sum := fmt.Sprintf("%x", sha256.Sum256(file.Body)); sum != expected.ZIP.SHA256 {
		t.Errorf("ZIP bytes differ from Node: %s", sum)
	}
	staleVersion := 11
	if _, err := service.FigureAt(ctx, run.ID, "f1", true, &staleVersion); err == nil {
		t.Fatal("an old figure URL resolved to the current revision")
	}
	currentVersion := 12
	still, err := service.FigureAt(ctx, run.ID, "f1", true, &currentVersion)
	if err != nil {
		t.Fatal(err)
	}
	if still.Filename != "figure-run-1-r2-f1.svg" || still.ContentType != svgType {
		t.Fatal("SVG headers differ")
	}
	equalBody(t, "static SVG", string(still.Body), expected.ZIP.Body["figures/f1.static.svg"])
	previous := 1
	old, err := service.Download(ctx, run.ID, &previous)
	if err != nil {
		t.Fatal(err)
	}
	equalBody(t, "previous TXT", string(old.Body), "# 이전\r\n\r\n원래 문단\r\n")
	oldZIP, err := service.Export(ctx, run.ID, Options{Format: "zip", Revision: &previous})
	if err != nil {
		t.Fatal(err)
	}
	if files := fileContents(t, oldZIP.Body); len(files) != 4 {
		t.Fatal("a current figure leaked into the previous revision")
	}
}

func TestOutboxApprovalAndAtomicRetry(t *testing.T) {
	ctx := context.Background()
	expected := fixture(t)
	underReview := fixtureRun(t, expected, "awaiting_user", "review", 1)
	root := t.TempDir()
	under := &Service{runs: runFixture{underReview}, outbox: root}
	_, err := under.Handoff(ctx, underReview.ID)
	var status *Error
	if !errors.As(err, &status) || status.Status != http.StatusConflict {
		t.Fatalf("expected pre-approval conflict, got %v", err)
	}

	run := fixtureRun(t, expected, "publication_ready", "confirmed", 2)
	service, err := New(runFixture{run}, root)
	if err != nil {
		t.Fatal(err)
	}
	const workers = 6
	var group sync.WaitGroup
	results := make(chan Delivery, workers)
	for range workers {
		group.Go(func() {
			result, err := service.Handoff(ctx, run.ID)
			if err != nil {
				t.Error(err)
				return
			}
			results <- result
		})
	}
	group.Wait()
	close(results)
	filename := "article-run-1-r2.zip"
	want := Delivery{filepath.Join(root, filename), strings.ReplaceAll(expected.Request, "/fixture/outbox", root)}
	for got := range results {
		if !reflect.DeepEqual(got, want) {
			t.Errorf("handoff: %#v", got)
		}
	}
	data, err := os.ReadFile(want.Path)
	if err != nil {
		t.Fatal(err)
	}
	equalZIP(t, data, expected.Handoff.Body)
	if sum := fmt.Sprintf("%x", sha256.Sum256(data)); sum != expected.Handoff.SHA256 {
		t.Errorf("handoff ZIP bytes differ from Node: %s", sum)
	}
	entries, err := os.ReadDir(root)
	if err != nil || len(entries) != 1 || entries[0].Name() != filename {
		t.Fatalf("outbox files: %v / %v", entries, err)
	}
}

func TestArtifactPathAndSVGGuards(t *testing.T) {
	ctx := context.Background()
	expected := fixture(t)
	run := fixtureRun(t, expected, "publication_ready", "confirmed", 2)
	dir := t.TempDir()
	destination := filepath.Join(dir, "outbox")
	if err := os.Mkdir(destination, 0o700); err != nil {
		t.Fatal(err)
	}
	service, err := New(runFixture{run}, destination)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Handoff(ctx, "../outside"); !errors.Is(err, contract.ErrNotFound) {
		t.Fatalf("unexpected traversal result: %v", err)
	}
	if _, err := service.Figure(ctx, run.ID, "../outside", false); err == nil {
		t.Fatal("accepted traversal as a figure ID")
	}
	external := filepath.Join(dir, "untouched")
	if err := os.WriteFile(external, []byte("기존 데이터"), 0o600); err != nil {
		t.Fatal(err)
	}
	symlink := filepath.Join(destination, "article-run-1-r2.zip")
	if err := os.Symlink(external, symlink); err != nil {
		t.Fatal(err)
	}
	if result, err := service.Handoff(ctx, run.ID); err == nil || result.Path != "" {
		t.Fatalf("success was reported for an incomplete handoff: %v %v", result, err)
	}
	data, err := os.ReadFile(external)
	if err != nil || string(data) != "기존 데이터" {
		t.Fatalf("external file changed: %v", err)
	}
	for index, svg := range []string{
		`<svg><x:script xmlns:x="http://www.w3.org/2000/svg"/></svg>`,
		`<svg><use href="https://outside.test/ref"/></svg>`,
		`<svg xml:base="https://outside.test"><use href="#id"/></svg>`,
		`<svg><set attributeName="xlink:href" to="#id"/></svg>`,
		`<svg><style><![CDATA[.x{fill:url(https://outside.test/ref)}]]></style></svg>`,
	} {
		t.Run(fmt.Sprint(index), func(t *testing.T) {
			if _, err := parseSVG(svg); !errors.Is(err, errUnsafeSVG) {
				t.Fatalf("unexpected SVG guard outcome %v", err)
			}
		})
	}
}
