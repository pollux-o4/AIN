// Package artifacts projects saved editorial runs into previews and portable files.
package artifacts

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf16"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/writing"
)

type RunReader interface {
	GetRun(context.Context, string) (contract.Run, error)
}

type Service struct {
	runs   RunReader
	outbox string
}

type File struct {
	Body        []byte
	ContentType string
	Filename    string
}

type Options struct {
	Revision *int
	Format   string
	Motion   string
}

type Delivery struct {
	Path    string `json:"path"`
	Request string `json:"request"`
}

type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string { return e.Message }

const (
	txtType  = "text/plain; charset=utf-8"
	htmlType = "text/html; charset=utf-8"
	svgType  = "image/svg+xml"
)

var (
	articleID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`)
	figureID  = regexp.MustCompile(`^f[1-9][0-9]?$`)
	titleLine = regexp.MustCompile(`(?m)^#[\t\p{Zs}]+([^\r\n]+)`)
)

type draft struct {
	Draft struct {
		Revision int
		Output   struct{ Text string }
	}
}
type revision struct {
	Revision  int
	Artifacts draft
}
type approval struct {
	Revision int
	Figures  []string
}
type figure struct {
	ID, Anchor, Claim, Alt, SVG string
	Caption                     *string
}
type figureGroup struct {
	Phase             string
	Candidates, Items []figure
	Selected          []string
	Failed            map[string]string
	Current           *struct {
		ID  string
		IDs []string
	}
}
type state struct {
	revision
	Version           int
	Idea, Status      string
	SatisfiedRevision int
	History           []revision
	Figure            *figureGroup
	Approval          *approval
}
type record struct {
	State  *state
	Issue  string
	Events []struct {
		Kind string
		At   *int64
	}
}

func New(runs RunReader, outbox string) (*Service, error) {
	if runs == nil || (outbox != "" && !filepath.IsAbs(outbox)) {
		return nil, errors.New("artifact reader and absolute outbox configuration required")
	}
	if outbox != "" {
		outbox = filepath.Clean(outbox)
	}
	return &Service{runs: runs, outbox: outbox}, nil
}

func readRecord(run contract.Run) (record, error) {
	var saved record
	if !articleID.MatchString(run.ID) {
		return saved, contract.ErrNotFound
	}
	if err := json.Unmarshal(run.Value, &saved); err != nil || saved.State == nil {
		return record{}, errors.New("invalid saved editorial run")
	}
	return saved, nil
}

func (s *Service) read(ctx context.Context, id string) (contract.Run, record, error) {
	if !articleID.MatchString(id) {
		return contract.Run{}, record{}, contract.ErrNotFound
	}
	run, err := s.runs.GetRun(ctx, id)
	if err != nil {
		return contract.Run{}, record{}, err
	}
	if run.ID != id {
		return contract.Run{}, record{}, errors.New("mismatched saved editorial run")
	}
	saved, err := readRecord(run)
	return run, saved, err
}

func (s state) presented() bool {
	switch s.Status {
	case "awaiting_user", "satisfied", "publication_ready":
		return true
	default:
		return s.Figure != nil && s.SatisfiedRevision == s.Revision
	}
}

func (s state) displayedDraft() (string, int) {
	if text := s.Artifacts.Draft.Output.Text; text != "" {
		return text, firstRevision(s.Artifacts.Draft.Revision, s.Revision)
	}
	for i := len(s.History) - 1; i >= 0; i-- {
		entry := s.History[i]
		if text := entry.Artifacts.Draft.Output.Text; text != "" {
			return text, firstRevision(entry.Artifacts.Draft.Revision, entry.Revision)
		}
	}
	return "", s.Revision
}

func firstRevision(artifact, fallback int) int {
	if artifact != 0 {
		return artifact
	}
	return fallback
}

func (s state) title() string {
	text, _ := s.displayedDraft()
	title, _, _ := strings.Cut(s.Idea, "\n")
	if match := titleLine.FindStringSubmatch(text); match != nil {
		title = match[1]
	}
	units := utf16.Encode([]rune(title))
	if len(units) > 100 {
		return string(utf16.Decode(units[:100])) + "…"
	}
	return title
}

func (s *Service) Download(ctx context.Context, id string, revision *int) (File, error) {
	return s.Export(ctx, id, Options{Revision: revision, Format: "txt"})
}

func (s *Service) Export(ctx context.Context, id string, options Options) (File, error) {
	run, saved, err := s.read(ctx, id)
	if err != nil {
		return File{}, err
	}
	state := saved.State
	_, target := state.displayedDraft()
	if options.Revision != nil {
		target = *options.Revision
	}
	var text string
	var figures []figure
	current := target == state.Revision && state.presented()
	if target == state.Revision && !current {
		// A legacy, incomplete workflow still exposes the saved draft via TXT.
		next, err := writing.New().Next(run)
		if err != nil {
			return File{}, err
		}
		current = next.Kind == "requirements_required"
	}
	if current {
		text = state.Artifacts.Draft.Output.Text
		if state.Figure != nil && state.Figure.Phase == "confirmed" {
			figures = state.Figure.Items
		}
	} else {
		for _, entry := range state.History {
			if entry.Revision == target {
				text = entry.Artifacts.Draft.Output.Text
				break
			}
		}
	}
	if text == "" {
		return File{}, &Error{http.StatusConflict, "내보낼 초안이 아직 없습니다."}
	}
	return exportArticle(article{id: id, title: state.title(), revision: target, text: text, figures: figures}, options)
}

func (s *Service) Preview(ctx context.Context, id string) (string, error) {
	run, saved, err := s.read(ctx, id)
	if err != nil {
		return "", err
	}
	return previewRecord(run, saved)
}

func (s *Service) Figure(ctx context.Context, id, requested string, still bool) (File, error) {
	return s.FigureAt(ctx, id, requested, still, nil)
}

// FigureAt binds cacheable versioned reads to the saved state used to form the URL.
func (s *Service) FigureAt(ctx context.Context, id, requested string, still bool, version *int) (File, error) {
	if !figureID.MatchString(requested) {
		return File{}, &Error{http.StatusNotFound, "시각자료를 찾을 수 없습니다."}
	}
	_, saved, err := s.read(ctx, id)
	if err != nil {
		return File{}, err
	}
	if version != nil && *version != saved.State.Version {
		return File{}, &Error{http.StatusNotFound, "시각자료를 찾을 수 없습니다."}
	}
	for _, spot := range spots(saved.State.Figure, false) {
		if spot.figure.ID == requested && spot.drawn {
			document, err := parseSVG(spot.figure.SVG)
			if err != nil {
				return File{}, err
			}
			body := document.body
			if still {
				body = document.static()
			}
			return File{
				Body: []byte(body), ContentType: svgType,
				Filename: fmt.Sprintf("figure-%s-r%d-%s.svg", id, saved.State.Revision, requested),
			}, nil
		}
	}
	return File{}, &Error{http.StatusNotFound, "시각자료를 찾을 수 없습니다."}
}
