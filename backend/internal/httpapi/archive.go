package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

type RunArchiver interface {
	SetArchived(context.Context, string, bool) error
}

func ArchiveRoutes(mux *http.ServeMux, service RunArchiver) {
	update := func(archive bool) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			id := r.PathValue("id")
			err := service.SetArchived(r.Context(), id, archive)
			switch {
			case errors.Is(err, contract.ErrConflict):
				writeError(w, http.StatusConflict, "진행 중인 작업은 먼저 중단해 주세요.")
			case err != nil:
				writeRunView(w, nil, err)
			default:
				writeJSON(w, http.StatusOK, map[string]any{"id": id, "archived": archive})
			}
		}
	}
	mux.HandleFunc("POST /write/api/runs/{id}/archive", update(true))
	mux.HandleFunc("POST /write/api/runs/{id}/restore", update(false))
}
