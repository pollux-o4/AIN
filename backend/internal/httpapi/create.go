package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/editorial"
)

type RunCreator interface {
	Create(context.Context, json.RawMessage) (contract.Run, error)
}

// CreateRoute registers writes independently from the list endpoint.
func CreateRoute(mux *http.ServeMux, creator RunCreator, views RunViews) {
	mux.HandleFunc("POST /write/api/runs", func(w http.ResponseWriter, r *http.Request) {
		body, ok := readJSON(w, r)
		if !ok {
			return
		}
		run, err := creator.Create(r.Context(), body)
		switch {
		case errors.Is(err, editorial.ErrInvalidInput):
			writeError(w, http.StatusBadRequest, editorial.ErrInvalidInput.Error())
		case errors.Is(err, contract.ErrConflict):
			writeError(w, http.StatusConflict, "같은 제출 번호의 입력이 달라졌습니다.")
		case err != nil:
			writeRunView(w, nil, err)
		default:
			view, err := views.RunView(r.Context(), run.ID)
			if err != nil || !json.Valid(view) {
				writeRunView(w, view, err)
				return
			}
			writeJSON(w, http.StatusAccepted, view)
		}
	})
}
