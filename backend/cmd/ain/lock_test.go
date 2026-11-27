package main

import (
	"path/filepath"
	"testing"
)

func TestEditorialDataHasOneGoWriter(t *testing.T) {
	root := filepath.Join(t.TempDir(), "private")
	first, err := lockData(root)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	if other, err := lockData(root); err == nil {
		other.Close()
		t.Fatal("another writer acquired the same data lock")
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := lockData(root)
	if err != nil {
		t.Fatal(err)
	}
	reopened.Close()
}
