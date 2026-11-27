package runtime

import (
	"errors"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

// Turns dispatches actions to the writing or figure prompt and result adapter.
type Turns struct {
	Writing     contract.TurnBuilder
	Figures     contract.TurnBuilder
	WritingRoot string
}

func (t Turns) builder(action contract.Action) (contract.TurnBuilder, error) {
	var builder contract.TurnBuilder
	switch action.Kind {
	case "request_ai", "request_route":
		builder = t.Writing
	case "request_figure":
		builder = t.Figures
	}
	if builder == nil {
		return nil, errors.New("no model adapter for editorial action")
	}
	return builder, nil
}

func (t Turns) BuildTurn(run contract.Run, action contract.Action) (contract.SessionSpec, error) {
	builder, err := t.builder(action)
	if err != nil {
		return contract.SessionSpec{}, err
	}
	spec, err := builder.BuildTurn(run, action)
	return t.scopeWriting(run, action, spec, err)
}

func (t Turns) ValidateResult(action contract.Action, result contract.Snapshot) (contract.Event, error) {
	builder, err := t.builder(action)
	if err != nil {
		return contract.Event{}, err
	}
	return builder.ValidateResult(action, result)
}
