package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"time"
)

const localOrigin = "http://127.0.0.1"

type articleView struct {
	ID       string
	Status   string
	Issue    *string
	Version  int64
	Revision int64
}

type articleAPI struct {
	handler http.Handler
	cookie  *http.Cookie
	token   string
}

func newArticleAPI(ctx context.Context, handler http.Handler, token string) (*articleAPI, error) {
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequestWithContext(ctx, http.MethodGet, localOrigin+"/write/session", nil))
	cookies := response.Result().Cookies()
	if response.Code != http.StatusNoContent || len(cookies) != 1 {
		return nil, errors.New("isolated Go editor did not issue a session")
	}
	return &articleAPI{handler: handler, cookie: cookies[0], token: token}, nil
}

func (api *articleAPI) call(ctx context.Context, method, path string, body []byte, agent bool) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	request := httptest.NewRequestWithContext(ctx, method, localOrigin+"/write/api/runs"+path, bytes.NewReader(body))
	if method == http.MethodPost {
		request.Header.Set("Content-Type", "application/json")
	}
	if agent {
		request.Header.Set("Authorization", "Bearer "+api.token)
	} else {
		request.Header.Set("Origin", localOrigin)
		request.AddCookie(api.cookie)
	}
	response := httptest.NewRecorder()
	api.handler.ServeHTTP(response, request)
	if response.Code >= 300 {
		return nil, fmt.Errorf("isolated Go editor returned HTTP %d", response.Code)
	}
	return response.Body.Bytes(), nil
}

func (api *articleAPI) json(ctx context.Context, method, path string, body []byte, dest any, agent bool) error {
	response, err := api.call(ctx, method, path, body, agent)
	if err != nil || dest == nil {
		return err
	}
	if json.Unmarshal(response, dest) != nil {
		return errors.New("isolated editor returned an invalid response")
	}
	return nil
}

func (api *articleAPI) get(ctx context.Context, path string) ([]byte, error) {
	return api.call(ctx, "GET", path, nil, false)
}

func (api *articleAPI) await(ctx context.Context, id string, prior int64, observedError *atomic.Bool, report *probeReport) (articleView, error) {
	if id == "" {
		return articleView{}, errors.New("isolated editor did not assign an article ID")
	}
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		var view articleView
		if err := api.json(ctx, http.MethodGet, "/"+id, nil, &view, false); err != nil {
			return view, err
		}
		if view.Status == "awaiting_user" && view.Revision > prior && view.Issue == nil {
			return view, nil
		}
		if view.Issue != nil || view.Status == "failed" || observedError.Load() {
			report.Stopped = "글 실행 상태를 확인해 주세요."
			return view, errors.New("Go editorial execution stopped before review")
		}
		select {
		case <-ctx.Done():
			return view, ctx.Err()
		case <-ticker.C:
		}
	}
}
