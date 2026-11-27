package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAGENT001CredentialPreservedAndPrivate(t *testing.T) {
	root := t.TempDir()
	first, err := credential(root, "agent-token", "")
	if err != nil {
		t.Fatal(err)
	}
	second, err := credential(root, "agent-token", "")
	if err != nil || second != first || len(first) != 64 {
		t.Fatalf("credential was not preserved: %v", err)
	}
	path := filepath.Join(root, "agent-token")
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("credential permissions: %v", err)
	}
	if err := os.Symlink(path, filepath.Join(root, "session-key")); err != nil {
		t.Fatal(err)
	}
	if _, err := credential(root, "session-key", ""); err == nil {
		t.Fatal("accepted redirected private credential")
	}
}
