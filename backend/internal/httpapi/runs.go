package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

// RunViews supplies public projections without exposing storage records.
type RunViews interface {
	ListView(context.Context) (json.RawMessage, error)
	RunView(context.Context, string) (json.RawMessage, error)
}

// ReadRoutes registers the public list and detail endpoints.
func ReadRoutes(mux *http.ServeMux, views RunViews) {
	mux.HandleFunc("GET /write/api/runs", func(w http.ResponseWriter, r *http.Request) {
		body, err := views.ListView(r.Context())
		writeRunView(w, body, err)
	})
	mux.HandleFunc("GET /write/api/runs/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if id == "" || strings.Contains(id, "/") {
			writeRunView(w, nil, contract.ErrNotFound)
			return
		}
		body, err := views.RunView(r.Context(), id)
		writeRunView(w, body, err)
	})
}

func writeRunView(w http.ResponseWriter, body json.RawMessage, err error) {
	switch {
	case errors.Is(err, contract.ErrNotFound):
		writeError(w, http.StatusNotFound, "글쓰기 작업을 찾을 수 없습니다.")
	case err != nil || !json.Valid(body):
		writeError(w, http.StatusInternalServerError, "요청을 처리하지 못했습니다. 입력은 보존돼 있습니다.")
	default:
		writeJSON(w, http.StatusOK, body)
	}
}
