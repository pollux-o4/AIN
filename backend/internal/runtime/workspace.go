package runtime

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

// ScopeWriting confines the default working directory to a stable article
// subdirectory, including when its remote writing session is reused.
func (t Turns) scopeWriting(run contract.Run, action contract.Action, spec contract.SessionSpec, err error) (contract.SessionSpec, error) {
	if err != nil || t.WritingRoot == "" || action.Kind == "request_figure" {
		return spec, err
	}
	sum := sha256.Sum256([]byte(run.ID))
	dir := filepath.Join(t.WritingRoot, hex.EncodeToString(sum[:]))
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return contract.SessionSpec{}, err
	}
	spec.WorkDir = dir
	return spec, nil
}
