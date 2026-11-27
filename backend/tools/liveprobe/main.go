// Command liveprobe runs a consented synthetic contract check on the Go stack.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/pollux-o4/AIN/backend/internal/paseowire"
)

type model struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
	Thinking string `json:"thinking"`
}

type config struct {
	Root     string          `json:"root"`
	Home     string          `json:"home"`
	Pilot    bool            `json:"pilot"`
	Article  bool            `json:"article"`
	Standard model           `json:"standard"`
	High     model           `json:"high"`
	Input    json.RawMessage `json:"input"`
	Feedback string          `json:"feedback"`
}

type probeReport struct {
	Phase            string   `json:"phase"`
	PilotCalls       int      `json:"pilotCalls"`
	ArticleCalls     int      `json:"articleCalls"`
	Created          int      `json:"created"`
	Reused           int      `json:"reused"`
	FeedbackRevision int64    `json:"feedbackRevision,omitempty"`
	DurationMS       int64    `json:"durationMs,omitempty"`
	CleanupIssues    []string `json:"cleanupIssues"`
	Stopped          string   `json:"stopped,omitempty"`
}

func main() {
	if os.Getenv("AIN_LIVE") != "1" {
		fmt.Fprintln(os.Stderr, "AIN_LIVE=1 이 필요합니다.")
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := execute(ctx); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func execute(ctx context.Context) error {
	var cfg config
	decode := json.NewDecoder(io.LimitReader(os.Stdin, 1<<20))
	decode.DisallowUnknownFields()
	if decode.Decode(&cfg) != nil || cfg.validate() != nil {
		return errors.New("invalid isolated live probe configuration")
	}
	client := paseowire.New(cfg.Home)
	report := probeReport{Phase: "setup", CleanupIssues: []string{}}
	phaseErr := runProbe(ctx, client, cfg, &report)
	if err := writePrivate(cfg.Root, "outcome.json", report); err != nil {
		return err
	}
	if phaseErr != nil {
		return phaseErr
	}
	if len(report.CleanupIssues) > 0 {
		return errors.New("live probe cleanup requires confirmation")
	}
	return nil
}

func (cfg config) validate() error {
	if !filepath.IsAbs(cfg.Root) || !filepath.IsAbs(cfg.Home) || (!cfg.Pilot && !cfg.Article) ||
		cfg.Standard.Provider == "" || cfg.Standard.Model == "" || (cfg.Article && !json.Valid(cfg.Input)) {
		return errors.New("missing probe configuration")
	}
	meta, err := os.Lstat(cfg.Root)
	if err != nil || !meta.IsDir() || meta.Mode().Perm()&0077 != 0 {
		return errors.New("trial directory must be a private directory")
	}
	children, err := os.ReadDir(cfg.Root)
	if err != nil || len(children) > 0 {
		return errors.New("trial directory must be fresh")
	}
	if cfg.High.Provider != "" && (cfg.High.Provider != cfg.Standard.Provider || cfg.High.Model != cfg.Standard.Model) {
		return errors.New("only the configured provider and model may be used")
	}
	return nil
}

func writePrivate(root, name string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return putPrivate(root, name, data)
}

func putPrivate(root, name string, data []byte) error {
	file, err := os.OpenFile(filepath.Join(root, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return fmt.Errorf("cannot create isolated %s", name)
	}
	_, writeErr := file.Write(data)
	return errors.Join(writeErr, file.Close())
}
