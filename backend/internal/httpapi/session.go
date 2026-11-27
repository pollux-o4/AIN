package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
)

const sessionCookie = "editorial-session"

type sessionAuth struct {
	session string
	agent   string
}

func newSessionAuth(key, agent string) (sessionAuth, error) {
	if len(key) < 32 || (agent != "" && (len(agent) < 32 || agent == key)) {
		return sessionAuth{}, errors.New("invalid or shared credentials")
	}
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte("ain-editorial-ui"))
	return sessionAuth{session: hex.EncodeToString(mac.Sum(nil)), agent: agent}, nil
}

func localOrigin(host string) (string, bool) {
	parsed, err := url.Parse("http://" + host)
	if err != nil || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", false
	}
	switch parsed.Hostname() {
	case "localhost", "127.0.0.1", "::1":
		return "http://" + parsed.Host, true
	}
	return "", false
}

func (a sessionAuth) issue(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: a.session, Path: "/write/",
		HttpOnly: true, SameSite: http.SameSiteStrictMode,
	})
}

func (a sessionAuth) authorize(w http.ResponseWriter, r *http.Request, origin string) (string, bool) {
	requestOrigin := r.Header.Get("Origin")
	if a.agent != "" && requestOrigin == "" &&
		hmac.Equal([]byte(r.Header.Get("Authorization")), []byte("Bearer "+a.agent)) {
		return "agent", true
	}
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || !hmac.Equal([]byte(cookie.Value), []byte(a.session)) {
		writeError(w, http.StatusUnauthorized, "글쓰기 화면을 다시 열어 주세요.")
		return "", false
	}
	if requestOrigin != "" && requestOrigin != origin {
		writeError(w, http.StatusForbidden, "다른 사이트의 요청은 허용하지 않습니다.")
		return "", false
	}
	if r.Method == http.MethodPost && requestOrigin != origin {
		writeError(w, http.StatusForbidden, "글쓰기 화면에서 요청해 주세요.")
		return "", false
	}
	return "user", true
}
