package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

// ActivitySource owns subscription cleanup. Its output contains public
// snapshots and uses a bounded, latest-value buffer.
type ActivitySource interface {
	OpenActivity(context.Context, string) (<-chan json.RawMessage, func(), error)
}

func ActivityRoute(mux *http.ServeMux, source ActivitySource) {
	mux.HandleFunc("GET /write/api/runs/{id}/activity", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			writeError(w, http.StatusMethodNotAllowed, "지원하지 않는 요청입니다.")
			return
		}
		id := r.PathValue("id")
		if id == "" || strings.Contains(id, "/") {
			writeRunView(w, nil, contract.ErrNotFound)
			return
		}
		snapshots, stop, err := source.OpenActivity(r.Context(), id)
		if err != nil {
			if errors.Is(err, r.Context().Err()) {
				return
			}
			writeRunView(w, nil, err)
			return
		}
		defer stop()
		WriteActivity(w, r, snapshots)
	})
}
