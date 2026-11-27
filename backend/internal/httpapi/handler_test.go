package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestAGENT001LocalAuthentication(t *testing.T) {
	key, token := strings.Repeat("k", 32), strings.Repeat("t", 32)
	handler, err := New(fstest.MapFS{"index.html": {Data: []byte("<html></html>")}}, key, token,
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte(Actor(r.Context())))
		}))
	if err != nil {
		t.Fatal(err)
	}
	session := httptest.NewRecorder()
	handler.ServeHTTP(session, httptest.NewRequest("GET", "http://localhost/write/session", nil))
	if session.Code != 204 || len(session.Result().Cookies()) != 1 {
		t.Fatalf("session response: %d", session.Code)
	}
	cookie := session.Result().Cookies()[0]
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode || cookie.Path != "/write/" {
		t.Fatal("missing session cookie restrictions")
	}
	cases := []struct {
		name, host, origin, bearer, actor string
		cookie                            bool
		status                            int
	}{
		{"CLI", "localhost", "", token, "agent", false, 200},
		{"CLI with Origin", "localhost", "http://localhost", token, "", false, 401},
		{"UI mutation", "localhost", "http://localhost", "", "user", true, 200},
		{"UI mutation without Origin", "localhost", "", "", "", true, 403},
		{"cross-origin mutation", "localhost", "http://other.invalid", "", "", true, 403},
		{"external host", "other.invalid", "", token, "", false, 403},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("POST", "http://"+tc.host+"/write/api/runs", nil)
			if tc.origin != "" {
				r.Header.Set("Origin", tc.origin)
			}
			if tc.bearer != "" {
				r.Header.Set("Authorization", "Bearer "+tc.bearer)
			}
			if tc.cookie {
				r.AddCookie(cookie)
			}
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			if w.Code != tc.status || tc.actor != "" && w.Body.String() != tc.actor {
				t.Fatalf("status=%d body=%q", w.Code, w.Body.String())
			}
		})
	}
}
