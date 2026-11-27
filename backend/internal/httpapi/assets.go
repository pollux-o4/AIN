package httpapi

import (
	"errors"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
)

func serveAsset(w http.ResponseWriter, r *http.Request, assets fs.FS, auth sessionAuth) bool {
	if r.Method != http.MethodGet {
		return false
	}

	name := "index.html"
	if r.URL.Path == "/write/" {
		if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+r.Host {
			writeError(w, http.StatusForbidden, "다른 사이트의 요청은 허용하지 않습니다.")
			return true
		}
	} else {
		asset, ok := strings.CutPrefix(r.URL.Path, "/write/assets/")
		if !ok {
			return false
		}
		if asset == "." || asset == ".." || path.Base(asset) != asset || !fs.ValidPath(asset) {
			writeError(w, http.StatusNotFound, "화면을 찾을 수 없습니다.")
			return true
		}
		name = "assets/" + asset
	}

	body, err := fs.ReadFile(assets, name)
	if err != nil {
		switch {
		case name == "index.html":
			writeError(w, http.StatusServiceUnavailable, "글쓰기 화면을 준비하지 못했습니다. 서비스를 다시 시작해 주세요.")
		case errors.Is(err, fs.ErrNotExist):
			writeError(w, http.StatusNotFound, "화면을 찾을 수 없습니다.")
		default:
			writeError(w, http.StatusInternalServerError, "화면을 읽지 못했습니다.")
		}
		return true
	}

	if name == "index.html" {
		auth.issue(w)
	}
	contentType := mime.TypeByExtension(path.Ext(name))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy",
		"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
	_, _ = w.Write(body)
	return true
}
