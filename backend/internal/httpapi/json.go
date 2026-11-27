package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
)

const maxJSONBytes = 4 << 20

func readJSON(w http.ResponseWriter, r *http.Request) (json.RawMessage, bool) {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeError(w, http.StatusUnsupportedMediaType, "JSON required")
		return nil, false
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxJSONBytes))
	var oversized *http.MaxBytesError
	if errors.As(err, &oversized) {
		writeError(w, http.StatusRequestEntityTooLarge, "Payload too large")
		return nil, false
	}
	if err != nil || !json.Valid(body) {
		writeError(w, http.StatusBadRequest, "올바른 입력 형식이 아닙니다.")
		return nil, false
	}
	return body, true
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, struct {
		Error string `json:"error"`
	}{Error: message})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
