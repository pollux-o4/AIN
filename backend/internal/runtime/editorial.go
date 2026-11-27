package runtime

import (
	"io/fs"
	"net/http"

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
	Runner     runner.Config
}

// Editorial wires the local HTTP application and its background execution
// loop to the same durable store. Its caller owns shutdown and the store.
func Editorial(store contract.Store, paseo contract.Paseo, turns contract.TurnBuilder, cfg EditorialConfig) (http.Handler, *runner.Runner, error) {
	rules := writing.NewWithFigures(figuredomain.New())
	scheduler, err := runner.New(store, paseo, rules, turns, cfg.Runner)
	if err != nil {
		return nil, nil, err
	}
	routes := http.NewServeMux()
	views := editorial.Queries{Store: store}
	httpapi.ReadRoutes(routes, views)
	httpapi.CreateRoute(routes, editorial.Creator{Store: store, Rules: rules, Scheduler: scheduler}, views)
	httpapi.ActionRoute(routes, editorial.Commands{Store: store, Rules: rules, Scheduler: scheduler}, views)

	handler, err := httpapi.New(cfg.Assets, cfg.SessionKey, cfg.AgentToken, routes)
	if err != nil {
		return nil, nil, err
	}
	return handler, scheduler, nil
}
