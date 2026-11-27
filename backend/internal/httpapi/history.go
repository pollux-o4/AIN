package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
)

type HistoryViews interface {
	HistoryView(context.Context, string) (json.RawMessage, error)
}

func HistoryRoute(mux *http.ServeMux, views HistoryViews) {
	mux.HandleFunc("GET /write/api/runs/{id}/history", func(w http.ResponseWriter, r *http.Request) {
		body, err := views.HistoryView(r.Context(), r.PathValue("id"))
		writeRunView(w, body, err)
	})
}
