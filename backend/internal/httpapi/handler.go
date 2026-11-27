package httpapi

import (
	"context"
	"errors"
	"io/fs"
	"net/http"
	"strings"
)

type actorKey struct{}

// Actor reports the authenticated user or agent for an editorial request.
func Actor(ctx context.Context) string {
	actor, _ := ctx.Value(actorKey{}).(string)
	return actor
}

// New composes the local editor shell with the authenticated editorial API.
func New(assets fs.FS, key, agentToken string, api http.Handler) (http.Handler, error) {
	if assets == nil || api == nil {
		return nil, errors.New("editorial assets and API are required")
	}
	auth, err := newSessionAuth(key, agentToken)
	if err != nil {
		return nil, err
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin, local := localOrigin(r.Host)
		if !local {
			writeError(w, http.StatusForbidden, "로컬 주소에서 열어 주세요.")
			return
		}
		switch r.URL.Path {
		case "/healthz":
			if r.Method == http.MethodGet {
				writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "protocol": "ain-editorial-4"})
				return
			}
		case "/write":
			http.Redirect(w, r, "/write/", http.StatusFound)
			return
		case "/write/session":
			if r.Method == http.MethodGet {
				if given := r.Header.Get("Origin"); given != "" && given != origin {
					writeError(w, http.StatusForbidden, "다른 사이트의 요청은 허용하지 않습니다.")
					return
				}
				w.Header().Set("Cache-Control", "no-store")
				auth.issue(w)
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		if serveAsset(w, r, assets, auth) {
			return
		}
		if strings.HasPrefix(r.URL.Path, "/write/api/") {
			if actor, allowed := auth.authorize(w, r, origin); allowed {
				api.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), actorKey{}, actor)))
			}
			return
		}
		for _, prefix := range []string{"/jobs", "/exports", "/providers"} {
			if r.URL.Path == prefix || strings.HasPrefix(r.URL.Path, prefix+"/") {
				writeError(w, http.StatusGone, "원시 실행 경로는 종료됐습니다. 글쓰기 화면과 편집 작업 계약을 사용해 주세요.")
				return
			}
		}
		writeError(w, http.StatusNotFound, "화면을 찾을 수 없습니다.")
	}), nil
}
