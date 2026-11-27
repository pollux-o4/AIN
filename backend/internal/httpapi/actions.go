package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/editorial"
	"github.com/pollux-o4/AIN/backend/internal/writing"
)

type RunCommander interface {
	Apply(context.Context, string, string, json.RawMessage) (contract.Run, error)
}

func ActionRoute(mux *http.ServeMux, commander RunCommander, views RunViews) {
	mux.HandleFunc("POST /write/api/runs/{id}/actions", func(w http.ResponseWriter, r *http.Request) {
		body, ok := readJSON(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		actor := Actor(r.Context())
		if actor == "" {
			writeError(w, http.StatusUnauthorized, "글쓰기 화면을 다시 열어 주세요.")
			return
		}
		_, err := commander.Apply(r.Context(), id, actor, body)
		switch {
		case errors.Is(err, writing.ErrHumanApproval):
			writeError(w, http.StatusForbidden, "사람의 확인이 필요한 작업입니다.")
		case errors.Is(err, writing.ErrAgentFeedbackLimit):
			writeError(w, http.StatusConflict, "사람의 확인 후 다시 수정해 주세요.")
		case errors.Is(err, contract.ErrConflict):
			writeError(w, http.StatusConflict, "다른 화면에서 작업이 변경됐습니다. 최신 내용을 확인해 주세요.")
		case errors.Is(err, editorial.ErrInvalidInput):
			writeError(w, http.StatusBadRequest, "지원하지 않는 요청입니다.")
		case err != nil:
			writeRunView(w, nil, err)
		default:
			view, err := views.RunView(r.Context(), id)
			writeRunView(w, view, err)
		}
	})
}
