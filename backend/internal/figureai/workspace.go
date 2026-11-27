package figureai

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"syscall"
	"unicode/utf8"
)

const (
	svgLimit    = 400000
	sourceLimit = 200000
)

var durableID = regexp.MustCompile(`^[0-9a-f]{64}$`)
var figureID = regexp.MustCompile(`^f[1-9][0-9]?$`)

type workspace struct {
	dir  string
	root *os.Root
}

func openWorkspace(base, id string, create bool) (*workspace, error) {
	if !durableID.MatchString(id) {
		return nil, errors.New("figure workspace requires a durable execution identity")
	}
	if !filepath.IsAbs(base) {
		return nil, errors.New("figure work root must be absolute")
	}
	if create {
		if err := os.MkdirAll(base, 0700); err != nil {
			return nil, errors.New("cannot prepare figure work root")
		}
	}
	parent, err := os.OpenRoot(base)
	if err != nil {
		return nil, errors.New("cannot open figure work root")
	}
	defer parent.Close()
	if create {
		if err := parent.Mkdir(id, 0700); err != nil && !errors.Is(err, os.ErrExist) {
			return nil, errors.New("cannot create figure workspace")
		}
	}
	info, err := parent.Lstat(id)
	if err != nil || !info.IsDir() {
		return nil, errors.New("invalid figure workspace")
	}
	child, err := parent.OpenRoot(id)
	if err != nil {
		return nil, errors.New("cannot open figure workspace")
	}
	actual, err := child.Stat(".")
	if err != nil || !os.SameFile(info, actual) {
		_ = child.Close()
		return nil, errors.New("figure workspace changed")
	}
	return &workspace{dir: filepath.Join(base, id), root: child}, nil
}

func (w *workspace) close() { _ = w.root.Close() }

func (w *workspace) read(path, name string, limit int64) (string, error) {
	if path != filepath.Join(w.dir, name) || !filepath.IsAbs(path) {
		return "", errors.New("figure artifact is outside its execution workspace or has the wrong name")
	}
	data, err := readRegular(w.root, name, limit*4)
	if err != nil {
		return "", err
	}
	if !utf8.Valid(data) || int64(utf16Length(string(data))) > limit {
		return "", errors.New("figure artifact exceeds its text contract")
	}
	return string(data), nil
}

func readRegular(root *os.Root, name string, maxBytes int64) ([]byte, error) {
	// Linux node tools may create special files. O_NONBLOCK allows rejecting
	// a substituted FIFO without blocking the scheduler while opening it.
	file, err := root.OpenFile(name, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, errors.New("cannot open figure artifact")
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return nil, errors.New("figure artifact must be a regular file")
	}
	if stat, ok := info.Sys().(*syscall.Stat_t); !ok || stat.Nlink != 1 {
		return nil, errors.New("figure artifact must not link to another file")
	}
	if info.Size() > maxBytes {
		return nil, errors.New("figure artifact exceeds its byte limit")
	}
	data, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil || int64(len(data)) > maxBytes {
		return nil, errors.New("cannot read bounded figure artifact")
	}
	return data, nil
}

func (w *workspace) putInput(name, body string) (string, error) {
	file, err := w.root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL|syscall.O_NOFOLLOW, 0600)
	if errors.Is(err, os.ErrExist) {
		data, readErr := readRegular(w.root, name, int64(len(body)))
		if readErr != nil || string(data) != body {
			return "", errors.New("figure input differs from the reserved baseline")
		}
		return filepath.Join(w.dir, name), nil
	}
	if err != nil {
		return "", errors.New("cannot write reserved figure input")
	}
	_, writeErr := io.WriteString(file, body)
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil {
		_ = w.root.Remove(name)
		return "", fmt.Errorf("cannot finish reserved figure input")
	}
	return filepath.Join(w.dir, name), nil
}

func utf16Length(value string) int {
	length := 0
	for _, r := range value {
		length++
		if r >= 0x10000 {
			length++
		}
	}
	return length
}
