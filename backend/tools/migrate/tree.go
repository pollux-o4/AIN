package main

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"golang.org/x/sys/unix"
)

var sourceTrees = []string{"ai-runtime", "n8n", "outbox"}
var candidateTrees = []string{"ai-runtime", "outbox"}

type fileEntry struct {
	Path      string `json:"path"`
	Directory bool   `json:"directory,omitempty"`
	Size      int64  `json:"size,omitempty"`
	SHA256    string `json:"sha256,omitempty"`
}

func within(parent, child string) bool {
	relative, err := filepath.Rel(parent, child)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func sourceRoot(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	root, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return "", errors.New("source must be a directory")
	}
	return root, nil
}

func privateParent(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	parent, err := sourceRoot(filepath.Dir(absolute))
	if err != nil {
		return "", err
	}
	info, err := os.Stat(parent)
	if err != nil {
		return "", err
	}
	if info.Mode().Perm()&0o022 != 0 {
		return "", errors.New("destination parent allows other users to write")
	}
	return filepath.Join(parent, filepath.Base(absolute)), nil
}

// walkTree walks only known source areas. SHA-256 is over the same bytes
// written into the snapshot, with a second source scan before publication.
func walkTree(ctx context.Context, src string, areas []string, dst string) ([]fileEntry, error) {
	source, err := os.OpenRoot(src)
	if err != nil {
		return nil, err
	}
	defer source.Close()
	var target *os.Root
	if dst != "" {
		target, err = os.OpenRoot(dst)
		if err != nil {
			return nil, err
		}
		defer target.Close()
	}
	var entries []fileEntry
	visit := func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if name == "." {
			return nil
		}
		if entry.IsDir() {
			if target != nil {
				if err := target.Mkdir(name, 0o700); err != nil {
					return err
				}
			}
			entries = append(entries, fileEntry{Path: name, Directory: true})
			return nil
		}
		if !entry.Type().IsRegular() {
			return errors.New("migration tree contains a symbolic link or special file")
		}
		item, err := digestFile(source, target, name)
		if err == nil {
			entries = append(entries, item)
		}
		return err
	}
	if areas == nil {
		err = fs.WalkDir(source.FS(), ".", visit)
	} else {
		for _, name := range areas {
			info, lookup := source.Lstat(name)
			if errors.Is(lookup, fs.ErrNotExist) && name != "ai-runtime" {
				continue
			}
			if lookup != nil || !info.IsDir() {
				return nil, errors.New("legacy data area is not a directory")
			}
			if err = fs.WalkDir(source.FS(), name, visit); err != nil {
				break
			}
		}
	}
	slices.SortFunc(entries, func(a, b fileEntry) int { return strings.Compare(a.Path, b.Path) })
	return entries, err
}

func digestFile(source, target *os.Root, path string) (fileEntry, error) {
	input, err := source.OpenFile(path, os.O_RDONLY|unix.O_NONBLOCK|unix.O_NOFOLLOW, 0)
	if err != nil {
		return fileEntry{}, err
	}
	defer input.Close()
	before, err := input.Stat()
	if err != nil || !before.Mode().IsRegular() {
		return fileEntry{}, errors.New("migration source is not a regular file")
	}
	hash := sha256.New()
	var writer io.Writer = hash
	var output *os.File
	if target != nil {
		output, err = target.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err != nil {
			return fileEntry{}, err
		}
		writer = io.MultiWriter(hash, output)
	}
	count, err := io.Copy(writer, input)
	if output != nil {
		err = errors.Join(err, output.Sync(), output.Close())
	}
	if err != nil {
		return fileEntry{}, err
	}
	after, err := source.Lstat(path)
	if err != nil || !os.SameFile(before, after) || count != before.Size() || count != after.Size() ||
		!before.ModTime().Equal(after.ModTime()) {
		return fileEntry{}, errors.New("source file changed during offline copy")
	}
	return fileEntry{Path: path, Size: count, SHA256: fmt.Sprintf("%x", hash.Sum(nil))}, nil
}

func syncDir(path string) error {
	dir, err := os.Open(path)
	if err != nil {
		return err
	}
	return errors.Join(dir.Sync(), dir.Close())
}

func syncTree(root string, entries []fileEntry) error {
	for _, item := range slices.Backward(entries) {
		if item.Directory {
			if err := syncDir(filepath.Join(root, item.Path)); err != nil {
				return err
			}
		}
	}
	return syncDir(root)
}

func publish(ctx context.Context, from, to string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	// Linux same-filesystem publication refuses even an existing empty directory.
	if err := unix.Renameat2(unix.AT_FDCWD, from, unix.AT_FDCWD, to, unix.RENAME_NOREPLACE); err != nil {
		return err
	}
	return syncDir(filepath.Dir(to))
}
