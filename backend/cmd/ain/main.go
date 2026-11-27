package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/figureai"
	"github.com/pollux-o4/AIN/backend/internal/paseowire"
	"github.com/pollux-o4/AIN/backend/internal/runner"
	"github.com/pollux-o4/AIN/backend/internal/runtime"
	"github.com/pollux-o4/AIN/backend/internal/sessions"
	"github.com/pollux-o4/AIN/backend/internal/store"
	"github.com/pollux-o4/AIN/backend/internal/writingai"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	address := flag.String("listen", "127.0.0.1:3230", "editorial loopback address")
	data := flag.String("data", "", "editorial data directory")
	assets := flag.String("assets", ".local/editorial-web", "built editor assets")
	home := flag.String("paseo-home", os.Getenv("PASEO_HOME"), "local Paseo home")
	provider := flag.String("provider", "", "Paseo provider")
	model := flag.String("model", "", "Paseo model")
	thinking := flag.String("thinking", "", "default Paseo thinking option")
	reviewThinking := flag.String("review-thinking", "", "Paseo thinking option for review and revisions")
	outbox := flag.String("outbox", "", "absolute publication outbox directory")
	labPolicyFile := flag.String("lab-policy", "", "private figure lab policy JSON")
	figureTools := flag.String("figure-tools", "", "directory holding layout-check.mjs and kit-index.mjs for figure turns")
	flag.Parse()
	if *data == "" || *home == "" || *provider == "" || *model == "" {
		return fmt.Errorf("data, paseo-home, provider and model are required")
	}
	if _, err := os.Stat(filepath.Join(*assets, "index.html")); err != nil {
		return fmt.Errorf("built editor assets are required")
	}
	root, err := filepath.Abs(*data)
	if err != nil {
		return err
	}
	policy, err := loadLabPolicy(root, *labPolicyFile, *outbox)
	if err != nil {
		return err
	}
	lock, err := lockData(root)
	if err != nil {
		return err
	}
	defer lock.Close()
	databasePath := filepath.Join(root, "editorial.sqlite")
	if err := store.RequireRuntimeSchema(ctx, databasePath); err != nil {
		return err
	}
	sessionKey, err := credential(root, "session-key", os.Getenv("AIN_SESSION_KEY"))
	if err != nil {
		return err
	}
	agentToken, err := credential(root, "agent-token", os.Getenv("AIN_AGENT_TOKEN"))
	if err != nil {
		return err
	}
	if sessionKey == agentToken {
		return fmt.Errorf("UI and agent credentials must differ")
	}
	db, err := store.Open(ctx, databasePath, store.WithLegacyPaseoRoot(filepath.Join(root, "jobs")))
	if err != nil {
		return err
	}
	defer db.Close()
	if policy != nil {
		if err := requireIdleLab(ctx, db); err != nil {
			return err
		}
	}
	wire := paseowire.New(*home)
	registry, err := db.SessionRegistry(ctx)
	if err != nil {
		return err
	}
	sessionManager, err := sessions.New(registry, wire, sessions.Config{Owner: root})
	if err != nil {
		return err
	}
	base := contract.SessionSpec{Provider: *provider, Model: *model, Thinking: *thinking, WorkDir: root}
	var high contract.SessionSpec
	if *reviewThinking != "" {
		high = contract.SessionSpec{Provider: *provider, Model: *model, Thinking: *reviewThinking}
	}
	builder := writingai.New(writingai.Config{Base: base, High: high})
	layoutCheck, kitIndex, err := figureToolPaths(*figureTools)
	if err != nil {
		return err
	}
	draw, err := figureai.New(figureai.Config{
		WorkRoot:    filepath.Join(root, "workspaces"),
		LabPolicy:   policy,
		Default:     figureai.Model{Provider: *provider, Model: *model, Thinking: *thinking},
		LayoutCheck: layoutCheck,
		KitIndex:    kitIndex,
	})
	if err != nil {
		return err
	}
	turns := runtime.Turns{Writing: builder, Figures: draw, WritingRoot: filepath.Join(root, "writing-workspaces")}
	return runtime.ServeEditorial(ctx, *address, db, wire, turns, runtime.EditorialConfig{
		Assets: os.DirFS(*assets), SessionKey: sessionKey, AgentToken: agentToken, Outbox: *outbox,
		Runner: runner.Config{OnError: reportExecution, Sessions: sessionManager, Workers: 4, Queue: 64, TurnLimit: 5 * time.Minute, RecheckInterval: 2 * time.Second, MaxRechecks: 5},
	})
}
