package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFigureLabRequiresConsentAndIsolatedPaths(t *testing.T) {
	dir := t.TempDir()
	t.Chdir(dir)
	data := filepath.Join(dir, ".local", "figure-lab", "runtime", "baseline")
	if err := os.MkdirAll(data, 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(data, "policy.json")
	if err := os.WriteFile(path, []byte(`{"plan":"fixture planning","check":"fixture check","draw":"fixture drawing"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("AIN_LIVE", "")
	if _, err := loadLabPolicy(data, path, ""); err == nil {
		t.Fatal("lab policy accepted without consent")
	}
	t.Setenv("AIN_LIVE", "1")
	for _, test := range []struct{ data, path, outbox string }{
		{dir, path, ""},
		{data, filepath.Join(dir, "policy.json"), ""},
		{data, path, filepath.Join(dir, "outbox")},
	} {
		if _, err := loadLabPolicy(test.data, test.path, test.outbox); err == nil {
			t.Fatal("non-isolated lab policy accepted")
		}
	}
	policy, err := loadLabPolicy(data, path, "")
	if err != nil || policy.Plan != "fixture planning" {
		t.Fatalf("lab policy = %+v, %v", policy, err)
	}
	if err := os.Link(path, filepath.Join(data, "editorial.sqlite")); err != nil {
		t.Fatal(err)
	}
	if _, err := loadLabPolicy(data, path, ""); err == nil {
		t.Fatal("hardlinked database accepted")
	}
}
