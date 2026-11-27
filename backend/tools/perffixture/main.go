// Command perffixture runs the real Go editor against an in-memory Paseo fake.
// Stdin/stdout are private fixture control, not endpoints of the editor.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing/fstest"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/figureai"
	"github.com/pollux-o4/AIN/backend/internal/runner"
	ainruntime "github.com/pollux-o4/AIN/backend/internal/runtime"
	"github.com/pollux-o4/AIN/backend/internal/sessions"
	"github.com/pollux-o4/AIN/backend/internal/store"
	"github.com/pollux-o4/AIN/backend/internal/writingai"
)

type config struct {
	Root              string
	Assets            string
	Idea              string
	HistoryCount      int
	HistoryBytes      int
	CompletionDelayMs int
	Replies           map[string]json.RawMessage
}

type request struct {
	ID        int
	Operation string
	Argument  string
}

type response struct {
	ID    int    `json:"id"`
	Value any    `json:"value,omitempty"`
	Error string `json:"error,omitempty"`
}

type application struct {
	config   config
	db       *tracedStore
	wire     *syntheticPaseo
	sessions *sessions.Manager
	handler  atomic.Pointer[http.Handler]
	cancel   context.CancelFunc
	done     chan error
	server   *http.Server
}

func main() {
	if err := execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func execute() error {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 8192), 4<<20)
	var configuration config
	if !scanner.Scan() || json.Unmarshal(scanner.Bytes(), &configuration) != nil || !filepath.IsAbs(configuration.Root) ||
		configuration.CompletionDelayMs < 1 || configuration.HistoryCount < 1 || configuration.HistoryBytes < 1024 {
		return errors.New("invalid performance fixture configuration")
	}
	app := application{config: configuration, wire: newSyntheticPaseo(configuration)}
	ctx := context.Background()
	if err := app.bind(ctx); err != nil {
		return err
	}
	defer func() { _ = app.stop() }()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return err
	}
	app.server = &http.Server{
		ReadHeaderTimeout: 5 * time.Second,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			(*app.handler.Load()).ServeHTTP(w, r)
		}),
	}
	go func() { _ = app.server.Serve(listener) }()
	defer app.server.Close()
	encoder := json.NewEncoder(os.Stdout)
	if err := encoder.Encode(response{Value: map[string]any{"url": "http://" + listener.Addr().String()}}); err != nil {
		return err
	}
	for scanner.Scan() {
		var req request
		if json.Unmarshal(scanner.Bytes(), &req) != nil {
			return errors.New("invalid performance fixture request")
		}
		result, err := app.invoke(ctx, req)
		reply := response{ID: req.ID, Value: result}
		if err != nil {
			reply.Error = err.Error()
		}
		if err := encoder.Encode(reply); err != nil {
			return err
		}
		if req.Operation == "stop" {
			return nil
		}
	}
	return scanner.Err()
}

func (app *application) bind(ctx context.Context) error {
	db, err := store.Open(ctx, app.database())
	if err != nil {
		return err
	}
	closeOnError := true
	defer func() {
		if closeOnError {
			_ = db.Close()
		}
	}()
	registry, err := db.SessionRegistry(ctx)
	if err != nil {
		return err
	}
	manager, err := sessions.New(registry, app.wire, sessions.Config{Owner: app.config.Root})
	if err != nil {
		return err
	}
	writing := writingai.New(writingai.Config{Base: contract.SessionSpec{
		Provider: "fixture", Model: "fixture-model", WorkDir: app.config.Root,
	}})
	figures, err := figureai.New(figureai.Config{
		WorkRoot: filepath.Join(app.config.Root, "workspaces"), Default: figureai.Model{Provider: "fixture", Model: "fixture-model"},
	})
	if err != nil {
		return err
	}
	assets := os.DirFS(app.config.Assets)
	var configAssets = ainruntime.EditorialConfig{
		SessionKey: "synthetic-session-key-not-a-secret", AgentToken: "synthetic-agent-key-not-a-secret00",
		Outbox: filepath.Join(app.config.Root, "outbox"),
		Runner: runner.Config{Sessions: manager, Workers: 4, Queue: 64, TurnLimit: 2 * time.Minute, RecheckInterval: 2 * time.Second, MaxRechecks: 5,
			OnError: func(_ string, err error) { app.wire.noteError(err) }},
	}
	if _, err := os.Stat(filepath.Join(app.config.Assets, "index.html")); err == nil {
		configAssets.Assets = assets
	} else {
		configAssets.Assets = fstest.MapFS{"index.html": {Data: []byte("<html></html>")}}
	}
	traced := &tracedStore{SQLite: db, paseo: app.wire}
	handler, scheduler, err := ainruntime.Editorial(traced, app.wire, ainruntime.Turns{Writing: writing, Figures: figures}, configAssets)
	if err != nil {
		return err
	}
	app.handler.Store(&handler)
	app.db, app.sessions = traced, manager
	loop, cancel := context.WithCancel(ctx)
	app.cancel = cancel
	app.done = make(chan error, 1)
	go func() { app.done <- scheduler.Run(loop) }()
	closeOnError = false
	return nil
}

func (app *application) database() string {
	return filepath.Join(app.config.Root, "data", "editorial.sqlite")
}

func (app *application) stop() error {
	if app.db == nil {
		return nil
	}
	err := app.stopRunner()
	err = errors.Join(err, app.db.Close())
	app.db = nil
	return err
}

func (app *application) invoke(ctx context.Context, req request) (any, error) {
	switch req.Operation {
	case "counts":
		return app.wire.counts(), nil
	case "traces":
		return app.wire.traces(), nil
	case "clean":
		return app.sessions.Sweep(ctx, app.db.activeAgent, true)
	case "seedAndRecover":
		return app.seedAndRecover(ctx, req.Argument)
	case "stop":
		return nil, app.stop()
	default:
		return nil, errors.New("unknown performance fixture command")
	}
}
