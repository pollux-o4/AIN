package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/unix"
)

func credential(root, name, override string) (string, error) {
	if override != "" {
		if len(override) < 32 {
			return "", errors.New("configured credential is too short")
		}
		return override, nil
	}
	path := filepath.Join(root, name)
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if errors.Is(err, os.ErrNotExist) {
		var secret [32]byte
		if _, err := rand.Read(secret[:]); err != nil {
			return "", err
		}
		token := hex.EncodeToString(secret[:])
		f, err := os.CreateTemp(root, ".credential-*")
		if err != nil {
			return "", err
		}
		defer os.Remove(f.Name())
		_, writeErr := f.WriteString(token + "\n")
		err = errors.Join(writeErr, f.Sync(), f.Close())
		if err != nil {
			return "", err
		}
		if err := os.Link(f.Name(), path); err != nil {
			return "", err
		}
		return token, nil
	}
	if err != nil {
		return "", err
	}
	f := os.NewFile(uintptr(fd), path)
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 || info.Size() > 1024 {
		return "", errors.New("invalid private editorial credential file")
	}
	data, err := io.ReadAll(io.LimitReader(f, 1025))
	if err != nil {
		return "", err
	}
	token := strings.TrimSpace(string(data))
	if len(token) < 32 || len(data) > 1024 {
		return "", errors.New("invalid editorial credential")
	}
	return token, nil
}
