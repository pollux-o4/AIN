package artifacts

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"slices"
)

func (s *Service) Handoff(ctx context.Context, id string) (Delivery, error) {
	_, saved, err := s.read(ctx, id)
	if err != nil {
		return Delivery{}, err
	}
	if s.outbox == "" {
		return Delivery{}, &Error{http.StatusServiceUnavailable, "보낼 폴더가 설정되지 않았습니다."}
	}
	state := saved.State
	approval := state.Approval
	if state.Status != "publication_ready" || approval == nil || approval.Revision != state.Revision {
		return Delivery{}, &Error{http.StatusConflict, "발행 준비가 승인된 글만 넘길 수 있습니다. 화면에서 승인해 주세요."}
	}
	text := state.Artifacts.Draft.Output.Text
	if text == "" {
		return Delivery{}, &Error{http.StatusConflict, "넘길 본문이 없습니다."}
	}
	var figures []figure
	approved := make(map[string]bool, len(approval.Figures))
	for _, id := range approval.Figures {
		approved[id] = true
	}
	if state.Figure != nil && state.Figure.Phase == "confirmed" {
		for _, item := range state.Figure.Items {
			if approved[item.ID] {
				figures = append(figures, item)
				delete(approved, item.ID)
			}
		}
	}
	if len(approved) != 0 {
		return Delivery{}, &Error{http.StatusConflict, "승인된 시각자료를 찾을 수 없습니다."}
	}
	var approvedAt *int64
	for _, event := range slices.Backward(saved.Events) {
		if event.Kind == "authorize_publication" {
			approvedAt = event.At
			break
		}
	}
	a := article{
		id: id, title: state.title(), revision: approval.Revision, text: text, figures: figures,
		approval: &bundleApproval{Revision: approval.Revision, ApprovedAt: approvedAt},
	}
	bundle, err := exportArticle(a, Options{Format: "zip"})
	if err != nil {
		return Delivery{}, err
	}
	path, err := writeOutbox(ctx, s.outbox, bundle)
	if err != nil {
		return Delivery{}, err
	}
	return Delivery{Path: path, Request: handoffRequest(a, path)}, nil
}

func handoffRequest(a article, path string) string {
	return fmt.Sprintf("AIN에서 발행 준비가 승인된 글 「%s」을 블로그에 게시해 주세요.\n- 묶음 파일: %s\n- 글 id %s · 승인 회차 %d\n- manifest.json에 본문 파일과 그림 배치 정보가 있습니다.", a.title, path, a.id, a.revision)
}

func writeOutbox(ctx context.Context, dir string, bundle File) (string, error) {
	if !filepath.IsLocal(bundle.Filename) || filepath.Base(bundle.Filename) != bundle.Filename {
		return "", errors.New("invalid outbox filename")
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return "", err
	}
	defer root.Close()

	temporary := ".ain-handoff-" + rand.Text() + ".tmp"
	file, err := root.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return "", err
	}
	defer root.Remove(temporary)
	if _, err = file.Write(bundle.Body); err == nil {
		err = file.Sync()
	}
	if err = errors.Join(err, file.Close()); err != nil {
		return "", err
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	// A sibling hard link publishes only complete bytes, without replacing an existing path.
	if err := root.Link(temporary, bundle.Filename); err != nil {
		if !errors.Is(err, fs.ErrExist) {
			return "", err
		}
		if err := readyBundle(root, bundle); err != nil {
			return "", err
		}
	}
	directory, err := root.Open(".")
	if err != nil {
		return "", err
	}
	if err := errors.Join(directory.Sync(), directory.Close()); err != nil {
		return "", err
	}
	return filepath.Join(dir, bundle.Filename), nil
}

func readyBundle(root *os.Root, bundle File) error {
	conflict := errors.New("outbox filename already exists with different content")
	info, err := root.Lstat(bundle.Filename)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() != int64(len(bundle.Body)) {
		return conflict
	}
	file, err := root.Open(bundle.Filename)
	if err != nil {
		return err
	}
	defer file.Close()
	body, err := io.ReadAll(io.LimitReader(file, int64(len(bundle.Body))+1))
	if err != nil {
		return err
	}
	if !bytes.Equal(body, bundle.Body) {
		return conflict
	}
	return nil
}
