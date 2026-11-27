package httpapi

import (
	"errors"
	"mime"
	"net/http"
	"strconv"

	"github.com/pollux-o4/AIN/backend/internal/artifacts"
)

func ArtifactRoutes(mux *http.ServeMux, service *artifacts.Service) {
	mux.HandleFunc("GET /write/api/runs/{id}/download", func(w http.ResponseWriter, r *http.Request) {
		revision, ok := optionalNumber(w, r, "revision")
		if ok {
			file, err := service.Download(r.Context(), r.PathValue("id"), revision)
			writeArtifact(w, file, true, err)
		}
	})
	mux.HandleFunc("GET /write/api/runs/{id}/export", func(w http.ResponseWriter, r *http.Request) {
		revision, ok := optionalNumber(w, r, "revision")
		if ok {
			query := r.URL.Query()
			file, err := service.Export(r.Context(), r.PathValue("id"), artifacts.Options{
				Revision: revision, Format: query.Get("format"), Motion: query.Get("motion"),
			})
			writeArtifact(w, file, true, err)
		}
	})
	mux.HandleFunc("GET /write/api/runs/{id}/figures/{figure}", func(w http.ResponseWriter, r *http.Request) {
		version, ok := optionalNumber(w, r, "v")
		if ok {
			query := r.URL.Query()
			file, err := service.FigureAt(r.Context(), r.PathValue("id"), r.PathValue("figure"), query.Get("motion") == "static", version)
			writeArtifact(w, file, query.Has("download"), err)
		}
	})
	mux.HandleFunc("POST /write/api/runs/{id}/handoff", func(w http.ResponseWriter, r *http.Request) {
		delivery, err := service.Handoff(r.Context(), r.PathValue("id"))
		if err != nil {
			writeArtifactError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, delivery)
	})
}

func optionalNumber(w http.ResponseWriter, r *http.Request, name string) (*int, bool) {
	raw, present := r.URL.Query()[name]
	if !present {
		return nil, true
	}
	n, err := strconv.Atoi(raw[0])
	if err != nil || n < 1 {
		writeError(w, http.StatusBadRequest, "파일 회차 또는 버전이 올바르지 않습니다.")
		return nil, false
	}
	return &n, true
}

func writeArtifact(w http.ResponseWriter, file artifacts.File, attachment bool, err error) {
	if err != nil {
		writeArtifactError(w, err)
		return
	}
	w.Header().Set("Content-Type", file.ContentType)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox")
	if attachment {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": file.Filename}))
	}
	_, _ = w.Write(file.Body)
}

func writeArtifactError(w http.ResponseWriter, err error) {
	var failure *artifacts.Error
	if errors.As(err, &failure) {
		writeError(w, failure.Status, failure.Message)
		return
	}
	writeRunView(w, nil, err)
}
