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
	outbox := flag.String("outbox", "", "absolute publication outbox directory")
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
	sessionKey, agentToken := os.Getenv("AIN_SESSION_KEY"), os.Getenv("AIN_AGENT_TOKEN")
	if len(sessionKey) < 32 || len(agentToken) < 32 || sessionKey == agentToken {
		return fmt.Errorf("separate AIN_SESSION_KEY and AIN_AGENT_TOKEN are required")
	}
	lock, err := lockData(root)
	if err != nil {
		return err
	}
	defer lock.Close()
	db, err := store.Open(ctx, filepath.Join(root, "editorial.sqlite"))
	if err != nil {
		return err
	}
	defer db.Close()
	wire := paseowire.New(*home)
	registry, err := db.SessionRegistry(ctx)
	if err != nil {
		return err
	}
	sessionManager, err := sessions.New(registry, wire, sessions.Config{Owner: root})
	if err != nil {
		return err
	}
	builder := writingai.New(writingai.Config{Base: contract.SessionSpec{
		Provider: *provider, Model: *model, WorkDir: root,
	}})
	draw, err := figureai.New(figureai.Config{
		WorkRoot: filepath.Join(root, "workspaces"),
		Default:  figureai.Model{Provider: *provider, Model: *model},
	})
	if err != nil {
		return err
	}
	turns := runtime.Turns{Writing: builder, Figures: draw}
	return runtime.ServeEditorial(ctx, *address, db, wire, turns, runtime.EditorialConfig{
		Assets: os.DirFS(*assets), SessionKey: sessionKey, AgentToken: agentToken, Outbox: *outbox,
		Runner: runner.Config{Sessions: sessionManager, Workers: 4, Queue: 64, TurnLimit: 5 * time.Minute, RecheckInterval: 2 * time.Second, MaxRechecks: 5},
	})
}
