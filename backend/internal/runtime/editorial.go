package runtime

import (
	"context"
	"errors"
	"io/fs"
	"net/http"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/artifacts"
	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/editorial"
	"github.com/pollux-o4/AIN/backend/internal/figuredomain"
	"github.com/pollux-o4/AIN/backend/internal/httpapi"
	"github.com/pollux-o4/AIN/backend/internal/runner"
	"github.com/pollux-o4/AIN/backend/internal/writing"
)

type EditorialConfig struct {
	Assets     fs.FS
	SessionKey string
	AgentToken string
	Outbox     string
	Runner     runner.Config
}

// Editorial wires the local HTTP application and its background execution
// loop to the same durable store. Its caller owns shutdown and the store.
func Editorial(store contract.Store, paseo contract.Paseo, turns contract.TurnBuilder, cfg EditorialConfig) (http.Handler, *runner.Runner, error) {
	rules := writing.NewWithFigures(figuredomain.New())
	if cfg.Runner.Reserve == nil {
		cfg.Runner.Reserve = func(run contract.Run, action contract.Action) (contract.Run, error) {
			return editorial.ReserveTurn(time.Now(), run, action)
		}
	}
	executionRules := editorial.ExecutionRules{EditorialRules: rules, Now: time.Now}
	if cfg.Runner.Paused == nil {
		cfg.Runner.Paused = editorial.PauseTransition(executionRules)
	}
	scheduler, err := runner.New(store, paseo, executionRules, turns, cfg.Runner)
	if err != nil {
		return nil, nil, err
	}
	routes := http.NewServeMux()
	files, err := artifacts.New(store, cfg.Outbox)
	if err != nil {
		return nil, nil, err
	}
	httpapi.ArtifactRoutes(routes, files)
	views := editorial.Queries{Store: store, Rules: rules}
	httpapi.ReadRoutes(routes, views)
	httpapi.HistoryRoute(routes, views)
	ActivityRoutes(routes, store, paseo, rules)
	httpapi.CreateRoute(routes, editorial.Creator{Store: store, Rules: rules, Scheduler: scheduler}, views)
	commands := editorial.Commands{Store: store, Rules: rules, Scheduler: scheduler}
	httpapi.ActionRoute(routes, commands, views)
	httpapi.ArchiveRoutes(routes, commands)

	handler, err := httpapi.New(cfg.Assets, cfg.SessionKey, cfg.AgentToken, routes)
	if err != nil {
		return nil, nil, err
	}
	return handler, scheduler, nil
}

// ServeEditorial gives the HTTP listener and scheduler a shared lifetime.
func ServeEditorial(ctx context.Context, address string, store contract.Store, paseo contract.Paseo, turns contract.TurnBuilder, cfg EditorialConfig) error {
	handler, scheduler, err := Editorial(store, paseo, turns, cfg)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	results := make(chan error, 2)
	go func() { results <- scheduler.Run(ctx) }()
	go func() { results <- Serve(ctx, address, handler) }()

	first := <-results
	cancel()
	second := <-results
	if errors.Is(first, context.Canceled) {
		first = nil
	}
	if errors.Is(second, context.Canceled) {
		second = nil
	}
	return errors.Join(first, second)
}
