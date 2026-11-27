package editorial

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"unicode/utf16"

	"github.com/google/uuid"
	"github.com/pollux-o4/AIN/backend/internal/contract"
)

var ErrInvalidInput = errors.New("글감과 참고 자료의 길이를 확인해 주세요.")

type Creator struct {
	Store     contract.Store
	Rules     contract.EditorialRules
	Scheduler contract.Scheduler
}

type createRequest struct {
	RequestID string          `json:"requestId"`
	Idea      string          `json:"idea"`
	Source    string          `json:"source"`
	Direction json.RawMessage `json:"direction"`
	Plan      json.RawMessage `json:"plan"`
}

func (c Creator) Create(ctx context.Context, body json.RawMessage) (contract.Run, error) {
	var input createRequest
	if err := json.Unmarshal(body, &input); err != nil ||
		strings.TrimSpace(input.RequestID) == "" || units(input.RequestID) > 100 ||
		strings.TrimSpace(input.Idea) == "" || units(input.Idea) > 12000 || units(input.Source) > 200000 {
		return contract.Run{}, ErrInvalidInput
	}
	articleID := uuid.NewString()
	payload := map[string]any{
		"articleId": articleID, "idea": strings.TrimSpace(input.Idea), "source": input.Source,
	}
	if input.Direction != nil {
		payload["direction"] = input.Direction
	}
	if input.Plan != nil {
		payload["plan"] = input.Plan
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return contract.Run{}, err
	}
	run, err := c.Rules.Reduce(contract.Run{ID: articleID, RequestID: input.RequestID}, contract.Event{
		ID: input.RequestID, Actor: "user", Kind: "start", Body: data,
	})
	if err != nil {
		return contract.Run{}, errors.Join(ErrInvalidInput, err)
	}
	err = c.Store.CreateRun(ctx, run)
	if errors.Is(err, contract.ErrConflict) {
		existing, readErr := c.Store.FindRequest(ctx, input.RequestID)
		if readErr != nil {
			return contract.Run{}, readErr
		}
		if !sameSubmission(existing.Value, run.Value) {
			return contract.Run{}, contract.ErrConflict
		}
		run = existing
	} else if err != nil {
		return contract.Run{}, err
	}
	c.Scheduler.Wake(run.ID)
	return run, nil
}

func units(s string) int {
	return len(utf16.Encode([]rune(s)))
}

func sameSubmission(a, b json.RawMessage) bool {
	type fields struct {
		Idea      string
		Source    string
		Direction map[string]any
	}
	var first, second struct{ State fields }
	return json.Unmarshal(a, &first) == nil && json.Unmarshal(b, &second) == nil &&
		reflect.DeepEqual(first.State, second.State)
}
