package main

import (
	"errors"
	"os"
	"path/filepath"
)

// figureToolPaths resolves the model-side figure tools named in the reference prompt.
// shortcut: 배포본은 Node 도구를 싣지 않아 -figure-tools에 소스 저장소 경로가 필요하다, 배포본에 그림 도구를 포함할 때 기본 경로를 패키지 안으로 바꾼다
func figureToolPaths(dir string) (string, string, error) {
	if dir == "" {
		return "", "", errors.New("-figure-tools is required: figure prompts name the layout check and kit index tools")
	}
	dir, err := filepath.Abs(dir)
	if err != nil {
		return "", "", err
	}
	layout, kit := filepath.Join(dir, "layout-check.mjs"), filepath.Join(dir, "kit-index.mjs")
	for _, path := range []string{layout, kit} {
		if info, err := os.Stat(path); err != nil || !info.Mode().IsRegular() {
			return "", "", errors.New("figure tool is missing: " + path)
		}
	}
	return layout, kit, nil
}
