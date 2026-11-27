package main

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"syscall"
)

var errWriter = errors.New("a process is still using the legacy data; stop the owning runtime before migration")

func findWriter(ctx context.Context, source string) error {
	return probeProc(ctx, "/proc", source, os.Geteuid(), os.Getpid())
}

// Open descriptors detect SQLite and n8n data access without contacting their
// APIs. The explicit offline assertion also covers sources no longer open.
func probeProc(ctx context.Context, proc, source string, uid, self int) error {
	processes, err := os.ReadDir(proc)
	if err != nil {
		return err
	}
	for _, entry := range processes {
		if err := ctx.Err(); err != nil {
			return err
		}
		pid, err := strconv.Atoi(entry.Name())
		if err != nil || pid == self || !entry.IsDir() {
			continue
		}
		path := filepath.Join(proc, entry.Name())
		info, err := entry.Info()
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || int(stat.Uid) != uid {
			continue
		}
		cwd, _ := os.Readlink(filepath.Join(path, "cwd"))
		cwd = strings.TrimSuffix(cwd, " (deleted)")
		if filepath.IsAbs(cwd) && within(source, cwd) {
			return errWriter
		}
		if cwd == filepath.Dir(source) {
			cmd, err := os.ReadFile(filepath.Join(path, "cmdline"))
			if err == nil && legacyWriterCommand(string(cmd)) {
				return errWriter
			}
		}
		fds, err := os.ReadDir(filepath.Join(path, "fd"))
		if errors.Is(err, fs.ErrNotExist) || errors.Is(err, fs.ErrPermission) {
			continue
		}
		if err != nil {
			return err
		}
		for _, fd := range fds {
			opened, err := os.Readlink(filepath.Join(path, "fd", fd.Name()))
			if err == nil && filepath.IsAbs(opened) &&
				within(source, strings.TrimSuffix(opened, " (deleted)")) {
				return errWriter
			}
		}
	}
	return nil
}

func legacyWriterCommand(command string) bool {
	args := strings.Split(command, "\x00")
	for _, arg := range args {
		path := strings.TrimPrefix(filepath.ToSlash(arg), "./")
		for _, script := range []string{
			"automation/runtime/start.mjs", "automation/editorial/start.mjs",
			"automation/runtime/server.mjs",
		} {
			if path == script || strings.HasSuffix(path, "/"+script) {
				return true
			}
		}
		if filepath.Base(arg) == "n8n" && slices.Contains(args, "start") {
			return true
		}
	}
	return false
}
