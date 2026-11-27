package editorial

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/writing"
)

type RunReader interface {
	GetRun(context.Context, string) (contract.Run, error)
	ListSummaries(context.Context, func(contract.RunSummary) error) error
}

type Queries struct {
	Store RunReader
	Rules *writing.Rules
}

func (q Queries) Run(ctx context.Context, id string) (json.RawMessage, error) {
	run, err := q.Store.GetRun(ctx, id)
	if err != nil {
		return nil, err
	}
	if !json.Valid(run.Value) {
		return nil, errors.New("invalid saved editorial run")
	}
	return run.Value, nil
}

func (q Queries) List(ctx context.Context) ([]contract.RunSummary, error) {
	result := make([]contract.RunSummary, 0)
	err := q.Store.ListSummaries(ctx, func(summary contract.RunSummary) error {
		result = append(result, summary)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}
